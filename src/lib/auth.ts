import { cookies } from "next/headers";
import { getIronSession, type IronSession } from "iron-session";

export interface SessionData {
  isAuthenticated: boolean;
}

const sessionSecret =
  process.env.DASHBOARD_SESSION_SECRET ??
  "dev-only-insecure-secret-change-me-before-deploying-xxxxxxxxxxxxxxxxxxxxx";

export const sessionOptions = {
  password: sessionSecret,
  cookieName: "dynasty_boys_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
  },
};

/**
 * Access is password-gated only when DASHBOARD_PASSWORD is set. This keeps
 * local `npm run dev` on localhost frictionless while making the app ready
 * to lock down before any non-local deployment.
 */
export function authRequired(): boolean {
  return !!process.env.DASHBOARD_PASSWORD;
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function isAuthenticated(): Promise<boolean> {
  if (!authRequired()) return true;
  const session = await getSession();
  return !!session.isAuthenticated;
}
