export const dynamic = "force-dynamic";

export async function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    "unknown";
  const ref =
    process.env.VERCEL_GIT_COMMIT_REF?.trim() ||
    process.env.GITHUB_REF_NAME?.trim() ||
    "unknown";

  return Response.json(
    {
      sha,
      ref,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      deploymentUrl: process.env.VERCEL_URL ?? null,
    },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
