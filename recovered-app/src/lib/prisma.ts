import { createHmac } from "node:crypto";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

const NEON_RUNTIME_HOST = "ep-odd-star-aw36ng5a.c-12.us-east-1.aws.neon.tech";
const NEON_RUNTIME_ROLE = "dashboard_runtime_bridge";
const NEON_RUNTIME_DATABASE = "neondb";
const BRIDGE_CONTEXT = "dynasty-boys-dashboard:neon-runtime-bridge:v1";

function deriveBridgePassword(configuredUrl: string): string {
  const parsed = new URL(configuredUrl);
  if (!parsed.password) throw new Error("Configured Prisma recovery URL has no password component.");
  const digest = createHmac("sha256", decodeURIComponent(parsed.password))
    .update(BRIDGE_CONTEXT)
    .digest("base64url");
  return `rt_${digest}`;
}

function resolveDatabaseUrl(): string {
  const explicitRecovery = process.env.RECOVERY_DATABASE_URL?.trim();
  if (explicitRecovery) return explicitRecovery;

  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) throw new Error("Database connection is not configured.");

  try {
    const parsed = new URL(configured);
    if (parsed.hostname === "db.prisma.io" || parsed.hostname === "pooled.db.prisma.io") {
      const neon = new URL(`postgresql://${NEON_RUNTIME_ROLE}@${NEON_RUNTIME_HOST}/${NEON_RUNTIME_DATABASE}`);
      neon.password = deriveBridgePassword(configured);
      neon.searchParams.set("sslmode", "require");
      return neon.toString();
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Prisma recovery URL")) throw error;
  }

  return configured;
}

const databaseUrl = resolveDatabaseUrl();
const pool = globalForPrisma.pgPool ?? new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pool;
}
