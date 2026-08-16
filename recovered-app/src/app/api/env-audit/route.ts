import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "RECOVERY_BACKUP_DATABASE_URL",
  "BACKUP_DATABASE_URL",
  "NEON_DATABASE_URL",
  "NEON_POSTGRES_URL",
  "PRISMA_DATABASE_URL",
  "PGHOST",
  "PGDATABASE",
  "PGUSER",
] as const;

function safeDescription(key: string, raw: string | undefined) {
  if (!raw) return { present: false };
  if (key === "PGHOST") return { present: true, host: raw, kind: raw.includes("neon.tech") ? "neon" : raw.includes("prisma.io") ? "prisma" : "other" };
  if (key === "PGDATABASE" || key === "PGUSER") return { present: true, valueLength: raw.length };
  try {
    const u = new URL(raw);
    return {
      present: true,
      protocol: u.protocol,
      host: u.hostname,
      database: u.pathname.replace(/^\//, "") || null,
      kind: u.hostname.includes("neon.tech") ? "neon" : u.hostname.includes("prisma.io") ? "prisma" : "other",
      pooled: u.hostname.includes("-pooler"),
    };
  } catch {
    return { present: true, valueLength: raw.length, kind: "non-url" };
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    vars: Object.fromEntries(KEYS.map((key) => [key, safeDescription(key, process.env[key])])),
  });
}
