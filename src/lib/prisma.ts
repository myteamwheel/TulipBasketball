import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
  patch14SchemaReady: Promise<void> | undefined;
};

const pool = globalForPrisma.pgPool ?? new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

export async function ensurePatch14Schema() {
  if (!globalForPrisma.patch14SchemaReady) {
    globalForPrisma.patch14SchemaReady = (async () => {
      await pool.query(`ALTER TYPE "MarketSource" ADD VALUE IF NOT EXISTS 'TRADYR'`);
      await pool.query(`ALTER TYPE "MarketSource" ADD VALUE IF NOT EXISTS 'DYNASTY_DEALER'`);
    })().catch((error) => {
      globalForPrisma.patch14SchemaReady = undefined;
      throw error;
    });
  }

  await globalForPrisma.patch14SchemaReady;
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pool;
}
