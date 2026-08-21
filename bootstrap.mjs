import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.join(HERE, "site", "dist");
const liveBase = "https://tulipbasketball.up.railway.app";

async function downloadAsset(assetPath) {
  const clean = assetPath.split("?")[0].split("#")[0];
  if (!clean.startsWith("/") || clean.startsWith("/gleague")) return null;
  const target = path.join(siteRoot, clean.replace(/^\/+/, ""));
  if (fs.existsSync(target)) return target;
  const response = await fetch(`${liveBase}${clean}`, { redirect: "follow" });
  if (!response.ok)
    throw new Error(`Could not preserve ${clean}: ${response.status}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return target;
}
async function mirrorCurrentSite() {
  fs.mkdirSync(siteRoot, { recursive: true });
  const queue = ["/"];
  const seen = new Set();
  while (queue.length) {
    const urlPath = queue.shift();
    if (seen.has(urlPath)) continue;
    seen.add(urlPath);
    const target = await downloadAsset(urlPath);
    if (!target) continue;
    const ext = path.extname(target).toLowerCase();
    if (![".html", ".js", ".css", ""].includes(ext)) continue;
    const text = fs.readFileSync(target, "utf8");
    for (const match of text.matchAll(
      /(?:src=|href=|["'`(])((?:\/assets\/)[A-Za-z0-9_./-]+)/g,
    ))
      if (!seen.has(match[1])) queue.push(match[1]);
  }
  const downloadedRoot = path.join(siteRoot, "index.html");
  const slashRoot = path.join(siteRoot, "");
  if (!fs.existsSync(downloadedRoot) && fs.existsSync(slashRoot))
    fs.renameSync(slashRoot, downloadedRoot);
}
function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    const a = path.join(source, name),
      b = path.join(target, name);
    if (fs.statSync(a).isDirectory()) copyDirectory(a, b);
    else fs.copyFileSync(a, b);
  }
}

if (!fs.existsSync(path.join(siteRoot, "index.html"))) {
  const archive = path.join(HERE, "site.tar.gz");
  if (fs.existsSync(archive)) {
    fs.mkdirSync(path.join(HERE, "site"), { recursive: true });
    execFileSync("tar", ["-xzf", archive, "-C", path.join(HERE, "site")], {
      stdio: "inherit",
    });
  } else {
    await mirrorCurrentSite();
  }
}
copyDirectory(
  path.join(HERE, "gleague-static"),
  path.join(siteRoot, "gleague"),
);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};
const port = Number(process.env.PORT) || 3000;
function safeFile(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(urlPath, "http://local").pathname);
  } catch {
    return null;
  }
  if (pathname === "/healthz") return "__health__";
  if (pathname === "/gleague" || pathname === "/gleague/")
    pathname = "/gleague/index.html";
  const normalized = path.posix.normalize(pathname).replace(/^\/+/, "");
  if (normalized.startsWith("..")) return null;
  let target = path.join(siteRoot, normalized);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory())
    target = path.join(target, "index.html");
  if (!fs.existsSync(target) && !path.extname(normalized))
    target = path.join(siteRoot, "index.html");
  return target.startsWith(siteRoot) ? target : null;
}
const server = http.createServer((req, res) => {
  const file = safeFile(req.url || "/");
  if (file === "__health__") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const ext = path.extname(file).toLowerCase(),
    immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    "content-type": mime[ext] || "application/octet-stream",
    "cache-control": immutable
      ? "public, max-age=31536000, immutable"
      : ext === ".html"
        ? "no-cache"
        : "public, max-age=3600",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(file)
    .on("error", () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    })
    .pipe(res);
});
server.listen(port, "0.0.0.0", () =>
  console.log(`TulipBasketball listening on ${port}`),
);
