const base = process.env.DASHBOARD_URL || "https://dynasty-boys-dashboard.vercel.app";
const pages = ["/", "/league", "/forecast", "/projections", "/trade-finder", "/waivers", "/transactions", "/players", "/settings", "/refresh-history", "/data-export"];
let failed = false;

for (const path of pages) {
  const response = await fetch(`${base}${path}`, { redirect: "follow", headers: { "user-agent": "dynasty-production-smoke/1.0" } });
  const text = await response.text();
  if (!response.ok || /Private market dashboard|sign in to continue|type="password"/i.test(text)) {
    console.error(`FAIL page ${path}: status=${response.status} passwordGate=${/type="password"/i.test(text)}`);
    failed = true;
  } else console.log(`PASS page ${path}: ${response.status}`);
}

try {
  const response = await fetch(`${base}/api/release`, {
    redirect: "follow",
    headers: { "user-agent": "dynasty-production-smoke/1.0" },
  });
  const payload = await response.json();
  const validSha = typeof payload?.sha === "string" && /^[0-9a-f]{7,40}$/i.test(payload.sha);
  const validRef = typeof payload?.ref === "string" && payload.ref.length > 0 && payload.ref !== "unknown";
  if (!response.ok || !validSha || !validRef) {
    console.error(`FAIL release provenance: status=${response.status} sha=${payload?.sha ?? "missing"} ref=${payload?.ref ?? "missing"}`);
    failed = true;
  } else {
    console.log(`PASS release provenance: ${payload.sha.slice(0, 12)} on ${payload.ref}`);
  }
} catch (error) {
  console.error(`FAIL release provenance: ${error instanceof Error ? error.message : String(error)}`);
  failed = true;
}



try {
  const response = await fetch(`${base}/api/projection-source-health`, {
    redirect: "follow",
    headers: { "user-agent": "dynasty-production-smoke/1.0" },
  });
  const payload = await response.json();
  const sourceHealthy =
    payload?.sources?.SLEEPER?.ok === true &&
    Number(payload?.sources?.SLEEPER?.rows ?? 0) >= 25;
  const classified = Number(payload?.stored?.classified ?? 0);
  const rostered = Number(payload?.rosteredSkillPlayers ?? 0);
  const storedCoverage =
    rostered > 0 ? classified / rostered : 0;
  if (!response.ok || !sourceHealthy || rostered < 25 || storedCoverage < 0.75) {
    console.error(
      `FAIL projection health: status=${response.status} sleeperRows=${payload?.sources?.SLEEPER?.rows ?? 0} classified=${classified}/${rostered} coverage=${storedCoverage.toFixed(3)}`,
    );
    failed = true;
  } else {
    console.log(
      `PASS projection health: Sleeper ${payload.sources.SLEEPER.rows} rows, stored ${classified}/${rostered} classified`,
    );
  }
} catch (error) {
  console.error(
    `FAIL projection health: ${error instanceof Error ? error.message : String(error)}`,
  );
  failed = true;
}

const protectedChecks = [
  ["POST", "/api/refresh"],
  ["GET", "/api/strategy"],
  ["POST", "/api/strategy"],
  ["POST", "/api/ktc/import"],
  ["GET", "/api/export/full-history"],
  ["GET", "/api/export/ktc-history"],
];
for (const [method, path] of protectedChecks) {
  const response = await fetch(`${base}${path}`, { method, redirect: "manual", headers: { "content-type": "application/json", "user-agent": "dynasty-production-smoke/1.0" }, body: method === "POST" ? "{}" : undefined });
  if (response.status !== 403) { console.error(`FAIL protected ${method} ${path}: expected 403, got ${response.status}`); failed = true; }
  else console.log(`PASS protected ${method} ${path}: 403`);
}
if (failed) process.exit(1);
