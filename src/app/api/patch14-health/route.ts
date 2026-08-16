import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function message(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

export async function GET() {
  try {
    const [enumRows, tableRows, marketRows] = await Promise.all([
      prisma.$queryRaw<Array<{ enumlabel: string }>>`
        SELECT e.enumlabel
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'MarketSource'
        ORDER BY e.enumsortorder
      `,
      prisma.$queryRaw<Array<{ table_name: string }>>`
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
      `,
      prisma.$queryRaw<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count FROM "MarketObservation"
      `,
    ]);

    return NextResponse.json({
      patch: 14,
      ok: true,
      databaseConfigured: Boolean(process.env.DATABASE_URL || process.env.RECOVERY_DATABASE_URL),
      marketSourceEnumLabels: enumRows.map((row) => row.enumlabel),
      expectedTablesPresent: tableRows.map((row) => row.table_name),
      marketObservationCheck: {
        ok: true,
        count: Number(marketRows[0]?.count ?? "0"),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        patch: 14,
        ok: false,
        databaseConfigured: Boolean(process.env.DATABASE_URL || process.env.RECOVERY_DATABASE_URL),
        error: message(error),
      },
      { status: 500 },
    );
  }
}
