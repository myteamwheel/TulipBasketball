import { NextResponse } from "next/server";
import { Pool } from "pg";

export const dynamic = "force-dynamic";

function message(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

export async function GET() {
  const databaseConfigured = Boolean(process.env.DATABASE_URL);

  if (!databaseConfigured) {
    return NextResponse.json(
      {
        patch: 14,
        databaseConfigured: false,
        ok: false,
        error: "DATABASE_URL is not configured in this deployment environment.",
      },
      { status: 500 },
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const [enumResult, tableResult] = await Promise.all([
      pool.query<{ enumlabel: string }>(`
        SELECT e.enumlabel
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'MarketSource'
        ORDER BY e.enumsortorder
      `),
      pool.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'League',
            'Manager',
            'Player',
            'RosterOwnership',
            'MarketObservation',
            'ConsensusObservation',
            'RefreshRun'
          )
        ORDER BY table_name
      `),
    ]);

    let marketObservationCheck: { ok: boolean; count?: number; error?: string };
    try {
      const result = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "MarketObservation"`,
      );
      marketObservationCheck = {
        ok: true,
        count: Number(result.rows[0]?.count ?? 0),
      };
    } catch (error) {
      marketObservationCheck = { ok: false, error: message(error) };
    }

    return NextResponse.json({
      patch: 14,
      ok: true,
      databaseConfigured: true,
      marketSourceEnumLabels: enumResult.rows.map((row) => row.enumlabel),
      expectedTablesPresent: tableResult.rows.map((row) => row.table_name),
      marketObservationCheck,
    });
  } catch (error) {
    return NextResponse.json(
      {
        patch: 14,
        ok: false,
        databaseConfigured: true,
        error: message(error),
      },
      { status: 500 },
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}
