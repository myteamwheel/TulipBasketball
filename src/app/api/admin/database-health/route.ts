import { timingSafeEqual } from "node:crypto";
import { Pool } from "pg";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Temporary, owner-only preview diagnostic. Credentials never leave the server,
// and all SQL runs in a read-only transaction. No production route is enabled.
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return new Response(null, { status: 404 });
  const expected = process.env.AUDIT_INGEST_TOKEN ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (expected.length < 32 || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return new Response(null, { status: 401 });
  }
  const { resolvePrimaryDatabaseUrl, resolveDatabaseUrl } = await import("@/lib/prisma");
  const targets = [{ name: "active", url: resolveDatabaseUrl() }, { name: "original", url: resolvePrimaryDatabaseUrl() }];
  const results = [];
  for (const target of targets) {
    const host = new URL(target.url).hostname;
    const pool = new Pool({ connectionString: target.url, max: 1, connectionTimeoutMillis: 8000, query_timeout: 8000, statement_timeout: 7000 });
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN READ ONLY");
        const database = await client.query("SELECT pg_database_size(current_database())::text AS bytes");
        const refresh = await client.query('SELECT status, "startedAt", "finishedAt" FROM "RefreshRun" ORDER BY "startedAt" DESC LIMIT 1');
        const counts = await client.query('SELECT (SELECT count(*)::int FROM "Manager") AS managers, (SELECT count(*)::int FROM "Player") AS players');
        await client.query("ROLLBACK");
        results.push({ name: target.name, host, healthy: true, database: database.rows[0], refresh: refresh.rows[0] ?? null, counts: counts.rows[0] });
      } finally { client.release(); }
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      results.push({ name: target.name, host, healthy: false, code: failure.code ?? "CONNECTION_FAILED", quotaExceeded: /exceeded the quota/i.test(failure.message ?? "") });
    } finally { await pool.end(); }
  }
  return Response.json({ checkedAt: new Date().toISOString(), results }, { headers: { "Cache-Control": "no-store" } });
}
