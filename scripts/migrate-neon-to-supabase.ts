/**
 * One-time, local-only Postgres migration utility.
 *
 * It asks for both connection URLs at runtime, keeps them only in memory, and
 * copies the public schema/data from the current database to a fresh Supabase
 * project. It neither changes the source database nor writes secrets to disk.
 *
 * Run: npx tsx scripts/migrate-neon-to-supabase.ts
 */
import { Client } from "pg";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type Column = { name: string; type: string; notNull: boolean; defaultValue: string | null };
type ForeignKey = { child: string; parent: string };

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

// Both managed Postgres providers enforce TLS. Their connection URLs can use
// provider certificate chains that `pg` does not have in its default CA store;
// encryption is still required, while this avoids rejecting that known chain.
function managedPostgresClient(connectionString: string) {
  // pg gives `sslmode` in the URI priority over the explicit `ssl` option.
  // Remove provider-specific TLS URI parameters first so the encrypted,
  // non-default provider chain configuration below is actually applied.
  const url = new URL(connectionString);
  for (const parameter of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    url.searchParams.delete(parameter);
  }
  return new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
}

async function prompt(label: string) {
  const terminal = createInterface({ input, output });
  try {
    const value = (await terminal.question(label)).trim();
    if (!value) throw new Error("A connection URL is required.");
    return value;
  } finally {
    terminal.close();
  }
}

async function publicTables(client: Client) {
  const { rows } = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return rows.map((row) => row.table_name).filter((table) => table !== "spatial_ref_sys");
}

async function columns(client: Client, table: string): Promise<Column[]> {
  const { rows } = await client.query<{
    name: string; type: string; not_null: boolean; default_value: string | null;
  }>(`
    SELECT a.attname AS name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
      a.attnotnull AS not_null,
      pg_get_expr(ad.adbin, ad.adrelid) AS default_value
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relname = $1
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `, [table]);
  return rows.map((row) => ({
    name: row.name,
    type: row.type,
    notNull: row.not_null,
    defaultValue: row.default_value,
  }));
}

async function enumTypes(client: Client) {
  const { rows } = await client.query<{ name: string; values: string[] | string }>(`
    SELECT t.typname AS name,
      array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public'
    GROUP BY t.typname
    ORDER BY t.typname
  `);
  return rows.map((row) => ({
    ...row,
    // `pg` normally parses text[] into a JS array. Some hosted Postgres
    // connection paths return its wire representation instead, so accept both.
    values: Array.isArray(row.values)
      ? row.values
      : row.values
          .replace(/^\{/, "")
          .replace(/\}$/, "")
          .split(",")
          .map((value) => value.replace(/^"|"$/g, "").replaceAll('\\"', '"')),
  }));
}

async function foreignKeys(client: Client): Promise<ForeignKey[]> {
  const { rows } = await client.query<ForeignKey>(`
    SELECT child.relname AS child, parent.relname AS parent
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE con.contype = 'f' AND ns.nspname = 'public'
  `);
  return rows;
}

function dependencyOrder(tables: string[], keys: ForeignKey[]) {
  const remaining = new Set(tables);
  const result: string[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter((table) =>
      keys.filter((key) => key.child === table).every((key) => !remaining.has(key.parent)),
    );
    if (!ready.length) {
      result.push(...[...remaining].sort());
      break;
    }
    ready.sort().forEach((table) => {
      remaining.delete(table);
      result.push(table);
    });
  }
  return result;
}

async function ensureTargetSchema(source: Client, target: Client, tables: string[]) {
  for (const item of await enumTypes(source)) {
    const members = item.values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
    await target.query(`DO $$ BEGIN CREATE TYPE public.${quote(item.name)} AS ENUM (${members}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  }

  for (const table of tables) {
    const sourceColumns = await columns(source, table);
    const targetColumns = new Set((await columns(target, table).catch(() => [])).map((column) => column.name));
    if (!targetColumns.size) {
      const definitions = sourceColumns.map((column) => [
        quote(column.name),
        column.type,
        column.defaultValue ? `DEFAULT ${column.defaultValue}` : "",
        column.notNull ? "NOT NULL" : "",
      ].filter(Boolean).join(" "));
      await target.query(`CREATE TABLE IF NOT EXISTS public.${quote(table)} (${definitions.join(", ")});`);
    } else {
      for (const column of sourceColumns.filter((column) => !targetColumns.has(column.name))) {
        await target.query(`ALTER TABLE public.${quote(table)} ADD COLUMN IF NOT EXISTS ${quote(column.name)} ${column.type};`);
      }
    }
  }

  const { rows: indexes } = await source.query<{ indexdef: string }>(`
    SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname
  `);
  for (const { indexdef } of indexes) {
    try { await target.query(indexdef); } catch (error) {
      if (!String(error).includes("already exists")) throw error;
    }
  }
}

async function copyTable(source: Client, target: Client, table: string) {
  const sourceColumns = await columns(source, table);
  const targetColumnNames = new Set((await columns(target, table)).map((column) => column.name));
  const usable = sourceColumns.filter((column) => targetColumnNames.has(column.name));
  if (!usable.length) throw new Error(`${table} has no matching destination columns.`);
  const names = usable.map((column) => quote(column.name));
  const { rows: countRows } = await source.query<{ count: string }>(`SELECT count(*)::text AS count FROM public.${quote(table)}`);
  const expected = Number(countRows[0]?.count ?? 0);
  const batchSize = 250;
  for (let offset = 0; offset < expected; offset += batchSize) {
    const { rows } = await source.query<Record<string, unknown>>(`SELECT ${names.join(", ")} FROM public.${quote(table)} LIMIT $1 OFFSET $2`, [batchSize, offset]);
    if (!rows.length) break;
    const params: unknown[] = [];
    const groups = rows.map((row, rowIndex) => `(${usable.map((_, columnIndex) => {
      params.push(row[usable[columnIndex].name]);
      return `$${rowIndex * usable.length + columnIndex + 1}`;
    }).join(", ")})`);
    await target.query(`INSERT INTO public.${quote(table)} (${names.join(", ")}) VALUES ${groups.join(", ")};`, params);
  }
  const { rows: targetCount } = await target.query<{ count: string }>(`SELECT count(*)::text AS count FROM public.${quote(table)}`);
  const actual = Number(targetCount[0]?.count ?? 0);
  if (actual !== expected) throw new Error(`${table}: expected ${expected} rows but copied ${actual}.`);
  console.log(`✓ ${table}: ${actual.toLocaleString()} rows`);
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Run: npx tsx scripts/migrate-neon-to-supabase.ts\nPrompts stay local and are never written to disk.");
    return;
  }
  console.log("This reads the source and writes only to the new Supabase database. It does not alter Neon.");
  // Keep the source variable distinct from generic local `DATABASE_URL`
  // values. This avoids accidentally connecting to an unrelated database
  // inherited from a shell profile.
  const sourceUrl = process.env.NEON_DATABASE_URL?.trim() || await prompt("Current Neon DATABASE_URL: ");
  const targetUrl = await prompt("New Supabase database connection URL: ");
  const source = managedPostgresClient(sourceUrl);
  const target = managedPostgresClient(targetUrl);
  try {
    await source.connect();
    await target.connect();
    await source.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = await publicTables(source);
    await ensureTargetSchema(source, target, tables);
    const ordered = dependencyOrder(tables, await foreignKeys(source));
    for (const table of ordered) await copyTable(source, target, table);
    for (const table of tables) {
      await target.query(`ALTER TABLE public.${quote(table)} ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.${quote(table)} FROM anon, authenticated;`);
    }
    await source.query("COMMIT");
    console.log(`\nMigration verified: ${tables.length} public tables have identical row counts.`);
    console.log("Do not change Vercel DATABASE_URL until you have saved this output.");
  } finally {
    await source.end().catch(() => undefined);
    await target.end().catch(() => undefined);
  }
}

main().catch((error) => { console.error("Migration stopped:", error); process.exitCode = 1; });
