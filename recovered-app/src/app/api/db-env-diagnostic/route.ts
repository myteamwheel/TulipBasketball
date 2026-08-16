import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeHost(value: string | undefined) {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.hostname;
  } catch {
    return '[present-but-not-url]';
  }
}

export async function GET() {
  const candidateNames = Object.keys(process.env)
    .filter((key) => /(DATABASE|POSTGRES|NEON|PRISMA)/i.test(key))
    .sort();
  const candidates = candidateNames.map((name) => ({
    name,
    host: safeHost(process.env[name]),
  }));
  const chosen = process.env.RECOVERY_DATABASE_URL?.trim()
    ? 'RECOVERY_DATABASE_URL'
    : process.env.DATABASE_URL
      ? 'DATABASE_URL'
      : null;
  return NextResponse.json({ chosen, candidates });
}
