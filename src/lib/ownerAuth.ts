import { timingSafeEqual } from "node:crypto";

export function isOwnerAuthorized(request: Request): boolean {
  const expected = process.env.DASHBOARD_ADMIN_KEY?.trim();
  if (!expected) return false;
  const supplied = request.headers.get("x-admin-key")?.trim() ?? "";
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function ownerUnauthorized(): Response {
  return Response.json({ error: "Owner authorization required." }, { status: 401 });
}
