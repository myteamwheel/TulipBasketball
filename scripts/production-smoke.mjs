const base = process.env.DASHBOARD_URL || "https://dynasty-boys-dashboard.vercel.app";
const pages = ["/", "/league", "/forecast", "/trade-finder", "/waivers", "/transactions", "/players", "/settings", "/refresh-history"];
let failed = false;

for (const path of pages) {
  const response = await fetch(`${base}${path}`, { redirect: "follow", headers: { "user-agent": "dynasty-production-smoke/1.0" } });
  const text = await response.text();
  if (!response.ok || /Private market dashboard|sign in to continue|type="password"/i.test(text)) {
    console.error(`FAIL page ${path}: status=${response.status} passwordGate=${/type="password"/i.test(text)}`);
    failed = true;
  } else console.log(`PASS page ${path}: ${response.status}`);
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
