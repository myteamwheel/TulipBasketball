const base = process.env.DASHBOARD_URL || "https://dynasty-boys-dashboard.vercel.app";
const headers = { "user-agent": "dynasty-production-smoke/1.0" };
let failed = false;

function fail(message) { console.error(`FAIL ${message}`); failed = true; }
function get(path) { return fetch(`${base}${path}`, { redirect: "follow", headers }); }

const pages = ["/", "/trade-review", "/team-outlook", "/team-outlook/trade-impact", "/forecast", "/projections", "/audit", "/audit/report", "/audit/research", "/league", "/trade-finder", "/waivers", "/transactions", "/players", "/refresh-history", "/settings", "/data-export"];
for (const path of pages) {
  const response = await get(path), text = await response.text();
  if (!response.ok || /id="__next_error__"|Application error: a server-side exception|Something went wrong|This dashboard view could not load its current data/i.test(text) || (path !== "/" && /Private market dashboard|sign in to continue|type="password"/i.test(text))) fail(`page ${path}: status=${response.status}`);
  else console.log(`PASS page ${path}: ${response.status}`);
}

try {
  const response = await get("/"), html = await response.text();
  const checks = { Orlando: /Orlando Oswalds/.test(html), ownerRefresh: /Dashboard refresh key/.test(html), visibleBrett: />Brett</.test(html) };
  if (!checks.Orlando || !checks.ownerRefresh || checks.visibleBrett) fail(`home identity and refresh controls: ${JSON.stringify(checks)}`);
  else console.log("PASS home identity and protected refresh control");
} catch (error) { fail(`home identity: ${error instanceof Error ? error.message : String(error)}`); }

try {
  const response = await get("/api/release"), payload = await response.json();
  const validSha = typeof payload?.sha === "string" && /^[0-9a-f]{7,40}$/i.test(payload.sha);
  const validRef = typeof payload?.ref === "string" && payload.ref.length > 0 && payload.ref !== "unknown";
  if (!response.ok || !validSha || !validRef) fail(`release provenance: status=${response.status}`);
  else console.log(`PASS release provenance: ${payload.sha.slice(0, 12)} on ${payload.ref}`);
} catch (error) { fail(`release provenance: ${error instanceof Error ? error.message : String(error)}`); }

try {
  const response = await get("/api/projection-source-health"), payload = await response.json();
  const sourceHealthy = ["SLEEPER", "CBS", "ESPN_DRAFTKINGS_ODDS"].every((source) => payload?.sources?.[source]?.ok === true && Number(payload.sources[source].rows ?? 0) > 0);
  const classified = Number(payload?.stored?.classified ?? 0), pending = Number(payload?.stored?.pending ?? 0), rostered = Number(payload?.rosteredSkillPlayers ?? 0);
  if (!response.ok || !sourceHealthy || rostered < 25 || classified + pending !== rostered) fail(`projection health: status=${response.status} sources=${JSON.stringify(payload?.sources)} classified=${classified}/${rostered} pending=${pending}`);
  else console.log(`PASS projection inputs and player accounting: ${classified} classified + ${pending} pending / ${rostered}`);
  const easternHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  if (easternHour >= 9 && pending > rostered * 0.25) fail(`projection refresh overdue: ${pending}/${rostered} players still pending after the morning refresh window`);
} catch (error) { fail(`projection health: ${error instanceof Error ? error.message : String(error)}`); }

try {
  const response = await get("/projections"), html = await response.text();
  const labels = ["Sleeper", "CBS", "local recency model", "DraftKings", "Active forecasts", "Locked at kickoff", "Withheld", "Completed", "How the projection model learns"];
  const missing = labels.filter((label) => !html.includes(label));
  if (!response.ok || missing.length) fail(`projection transparency: missing ${missing.join(", ")}`);
  else console.log("PASS projection source breakdown and stat-line labels");
} catch (error) { fail(`projection transparency: ${error instanceof Error ? error.message : String(error)}`); }

try {
  const response = await get("/api/audit"), payload = await response.json(), health = payload?.data?.health;
  const refreshAge = Date.now() - Date.parse(health?.latestRefreshAt ?? "");
  if (!Number.isFinite(refreshAge) || refreshAge < 0 || refreshAge > 32 * 3600000) fail("audit refresh timestamp is missing, future-dated, or more than 32 hours old");
  if (!response.ok || health?.auditValidated !== true || health?.projectionReady !== true || health?.latestRefreshStatus !== "SUCCESS") fail(`audit health: status=${response.status} health=${JSON.stringify(health)}`);
  else console.log(`PASS audit health: ${health.rosteredPlayers} rostered, ${health.valuedPlayers} valued`);
} catch (error) { fail(`audit health: ${error instanceof Error ? error.message : String(error)}`); }

try {
  const response = await get("/api/audit/research"), payload = await response.json();
  const names = new Set((payload?.tables ?? []).map((table) => table.name));
  const required = ["current_brett_players", "future_picks", "audit_core_per_league", "recommendations", "trends_manager_season", "brett_trades_ranked"];
  const missing = required.filter((name) => !names.has(name));
  if (!response.ok || payload?.published !== true || Number(payload?.tables?.length) !== 80 || missing.length) fail(`published audit coverage: status=${response.status} tables=${payload?.tables?.length} missing=${missing.join(",")}`);
  else console.log("PASS published audit coverage: 80 source tables");
} catch (error) { fail(`published audit coverage: ${error instanceof Error ? error.message : String(error)}`); }

try {
  const response = await get("/audit/report"), html = await response.text();
  const sections = ["League snapshot", "Orlando Oswalds trade review", "Strategy and recommendations", "League history and trends", "Download Excel", "Download PDF"];
  const missing = sections.filter((section) => !html.includes(section));
  if (!response.ok || missing.length) fail(`organized report: missing ${missing.join(", ")}`);
  else console.log("PASS organized native audit report");
} catch (error) { fail(`organized report: ${error instanceof Error ? error.message : String(error)}`); }

for (const [label, path, signature] of [["audit PDF", "/api/audit/research?file=Dynasty-Bois-Report.pdf", "%PDF"], ["audit Excel", "/api/audit/research?file=Dynasty-Bois-Data.xlsx", "PK"]]) {
  try {
    const response = await get(path), body = Buffer.from(await response.arrayBuffer());
    if (!response.ok || body.length < 100 || !body.subarray(0, signature.length).equals(Buffer.from(signature))) fail(`${label}: status=${response.status} bytes=${body.length}`);
    else console.log(`PASS ${label}: ${body.length} bytes`);
  } catch (error) { fail(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
}

try {
  const response = await fetch(`${base}/api/admin/refresh`, { method: "POST", redirect: "manual", headers });
  if (response.status !== 401) fail(`manual refresh protection: expected 401, got ${response.status}`);
  else console.log("PASS manual refresh protection: 401 without owner key");
} catch (error) { fail(`manual refresh protection: ${error instanceof Error ? error.message : String(error)}`); }

const protectedChecks = [["POST", "/api/refresh"], ["GET", "/api/strategy"], ["POST", "/api/strategy"], ["POST", "/api/ktc/import"], ["GET", "/api/export/full-history"], ["GET", "/api/export/ktc-history"]];
for (const [method, path] of protectedChecks) {
  const response = await fetch(`${base}${path}`, { method, redirect: "manual", headers: { ...headers, "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
  if (response.status !== 403) fail(`protected ${method} ${path}: expected 403, got ${response.status}`);
  else console.log(`PASS protected ${method} ${path}: 403`);
}

if (failed) process.exit(1);
