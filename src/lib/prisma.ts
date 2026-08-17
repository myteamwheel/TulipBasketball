import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

const BRIDGE_CONTEXT = "dynasty-boys-dashboard:neon-runtime-bridge:v1";
const ENVELOPE_CONTEXT = "dynasty-boys-dashboard:neon-owner-envelope:v1";
const NEON_ENVELOPE = {
  v: 1,
  alg: "A256GCM",
  iv: "G4X2wNEo8XAp4iqY",
  tag: "skodFpQcRdNArZwPVCcMZQ",
  ciphertext:
    "MdnrQOJaOKCVpZUy2db_GQVDCnRPLIwdSMlsovri9qwn5cXsNaJcgxwmIAn1j3HYHkwT27bz3w0SYclAGxMgp6T64FrMNEXlzk8AsW75758aDafa-hI4zJMGLiqM85f0jYo-KqgtebnXo8fJETN5yUKY8wv3sLQsClTYbO252Zw8CkwzVmkbOVCyrSHCn9kpsEg",
} as const;

function deriveBridgePassword(configuredUrl: string) {
  const parsed = new URL(configuredUrl);
  if (!parsed.password) throw new Error("Configured database URL has no password component.");
  const digest = createHmac("sha256", decodeURIComponent(parsed.password))
    .update(BRIDGE_CONTEXT)
    .digest("base64url");
  return `rt_${digest}`;
}

function normalizePostgresSslMode(value: string) {
  try {
    const parsed = new URL(value);
    if (!parsed.hostname.endsWith(".neon.tech")) return value;
    const mode = parsed.searchParams.get("sslmode")?.toLowerCase();
    if (mode === "require" || mode === "prefer" || mode === "verify-ca") {
      // pg currently treats these as verify-full but warns that the aliases will
      // change semantics in the next major release. Make the intended strict
      // verification explicit so runtime behavior remains stable and warning-free.
      parsed.searchParams.set("sslmode", "verify-full");
      return parsed.toString();
    }
  } catch {
    return value;
  }
  return value;
}

function decryptNeonDatabaseUrl(configuredUrl: string) {
  const bridgePassword = deriveBridgePassword(configuredUrl);
  const key = createHash("sha256")
    .update(`${ENVELOPE_CONTEXT}\0${bridgePassword}`)
    .digest();

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(NEON_ENVELOPE.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(NEON_ENVELOPE.tag, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(NEON_ENVELOPE.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");

  const parsed = new URL(plaintext);
  if (!parsed.hostname.endsWith(".neon.tech")) {
    throw new Error("Recovered database envelope did not resolve to the expected Neon host.");
  }
  return normalizePostgresSslMode(plaintext);
}

function resolveDatabaseUrl() {
  const explicitRecovery = process.env.RECOVERY_DATABASE_URL?.trim();
  if (explicitRecovery) return normalizePostgresSslMode(explicitRecovery);

  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) throw new Error("Database connection is not configured.");

  try {
    const parsed = new URL(configured);
    if (parsed.hostname === "db.prisma.io" || parsed.hostname === "pooled.db.prisma.io") {
      return decryptNeonDatabaseUrl(configured);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Recovered database envelope")) throw error;
    if (error instanceof Error && error.message.includes("password component")) throw error;
  }

  return normalizePostgresSslMode(configured);
}

const databaseUrl = resolveDatabaseUrl();
const pool = globalForPrisma.pgPool ?? new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pool;
}
