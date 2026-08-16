import { redirect } from "next/navigation";
import { getSession, authRequired } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  if (password && password === process.env.DASHBOARD_PASSWORD) {
    const session = await getSession();
    session.isAuthenticated = true;
    await session.save();
    redirect("/");
  }
  redirect("/login?error=1");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!authRequired()) redirect("/");
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-8 shadow-xl">
        <h1 className="mb-1 text-lg font-semibold text-neutral-100">Dynasty Boys</h1>
        <p className="mb-6 text-sm text-neutral-400">Private market dashboard — sign in to continue.</p>
        <form action={login} className="space-y-4">
          <input
            type="password"
            name="password"
            placeholder="Password"
            autoFocus
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          />
          {error && <p className="text-sm text-red-400">Incorrect password.</p>}
          <button
            type="submit"
            className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
