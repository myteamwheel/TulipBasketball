import { timingSafeEqual } from "node:crypto";

export function isOwnerAuthorized(request: Request): boolean {
  const supplied = request.headers.get("x-admin-key")?.trim() ?? "";
  if (!supplied) return false;
  // DASHBOARD_ADMIN_KEY is preferred. CRON_SECRET is an existing owner-only
  // Vercel secret and lets the manual control work on installations that were
  // deployed before a separate dashboard key was configured.
  const expectedKeys = [
    process.env.DASHBOARD_ADMIN_KEY?.trim(),
    process.env.CRON_SECRET?.trim(),
  ].filter((value): value is string => Boolean(value));
  return expectedKeys.some((expected) => {
    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export function ownerUnauthorized(): Response {
  return Response.json({ error: "Owner authorization required." }, { status: 401 });
}
