import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  authConfigurationValid,
  authRequired,
  clearLoginFailures,
  getSession,
  loginRateLimitStatus,
  passwordMatches,
  recordLoginFailure,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  if (!authConfigurationValid()) redirect("/login?error=config");

  const h = await headers();
  const key = (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown").slice(0, 96);
  const limit = loginRateLimitStatus(key);
  if (!limit.allowed) redirect(`/login?error=rate&retry=${limit.retryAfterSeconds}`);

  const password = String(formData.get("password") ?? "");
  if (passwordMatches(password)) {
    clearLoginFailures(key);
    const session = await getSession();
    session.isAuthenticated = true;
    await session.save();
    redirect("/");
  }

  recordLoginFailure(key);
  redirect("/login?error=1");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; retry?: string }>;
}) {
  if (!authRequired()) redirect("/");
  const { error, retry } = await searchParams;

  const errorText = error === "rate"
    ? `Too many failed attempts. Try again in about ${Math.max(1, Math.ceil(Number(retry || 60) / 60))} minute(s).`
    : error === "config"
      ? "Dashboard authentication is not configured correctly. Access remains locked."
      : error
        ? "Incorrect password."
        : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl">
        <h1 className="mb-1 text-lg font-semibold text-neutral-100">Dynasty Boys</h1>
        <p className="mb-6 text-sm text-neutral-400">Private market dashboard — sign in to continue.</p>
        <form action={login} className="space-y-4">
          <input
            type="password"
            name="password"
            placeholder="Password"
            autoComplete="current-password"
            autoFocus
            required
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          />
          {errorText ? <p className="text-sm leading-5 text-red-400">{errorText}</p> : null}
          <button type="submit" className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
