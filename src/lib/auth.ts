import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getIronSession, type IronSession } from "iron-session";

export interface SessionData {
  isAuthenticated: boolean;
}

type Attempt = { count: number; resetAt: number };

declare global {
  // eslint-disable-next-line no-var
  var __dynastyLoginAttempts: Map<string, Attempt> | undefined;
}

const attempts = globalThis.__dynastyLoginAttempts ?? new Map<string, Attempt>();
globalThis.__dynastyLoginAttempts = attempts;

const FALLBACK_SESSION_SECRET = "disabled-production-session-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

function configuredSessionSecret(): string | null {
  const value = process.env.DASHBOARD_SESSION_SECRET?.trim() ?? "";
  return value.length >= 32 ? value : null;
}

export function authConfigurationValid(): boolean {
  const password = process.env.DASHBOARD_PASSWORD?.trim() ?? "";
  if (process.env.NODE_ENV !== "production") return true;
  return password.length > 0 && configuredSessionSecret() !== null;
}

function sessionOptions() {
  return {
    password: configuredSessionSecret() ?? FALLBACK_SESSION_SECRET,
    cookieName: "dynasty_boys_session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * 14,
    },
  };
}

/** Dashboard access is intentionally open; no application password is required. */
export function authRequired(): boolean {
  return false;
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

export async function isAuthenticated(): Promise<boolean> {
  if (!authRequired()) return true;
  if (!authConfigurationValid()) return false;
  const session = await getSession();
  return !!session.isAuthenticated;
}

/** Constant-length digest comparison avoids leaking useful prefix timing. */
export function passwordMatches(candidate: string): boolean {
  const configured = process.env.DASHBOARD_PASSWORD ?? "";
  if (!configured || !candidate) return false;
  const expected = createHash("sha256").update(configured, "utf8").digest();
  const supplied = createHash("sha256").update(candidate, "utf8").digest();
  return timingSafeEqual(expected, supplied);
}

export function loginRateLimitStatus(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const row = attempts.get(key);
  if (!row || row.resetAt <= now) {
    if (row) attempts.delete(key);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (row.count < LOGIN_MAX_FAILURES) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((row.resetAt - now) / 1000)) };
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const row = attempts.get(key);
  if (!row || row.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else attempts.set(key, { count: row.count + 1, resetAt: row.resetAt });
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}
