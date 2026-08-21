import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "site", "dist", "gleague", "data.generated.js");
const SUMMARY = path.join(ROOT, "scripts", "gleague-data-summary.json");
const SEASONS = Array.from(
  { length: 25 },
  (_, i) => `${2001 + i}-${String(2 + i).padStart(2, "0")}`,
);
const TEAM_CODES = [
  "LIN",
  "WES",
  "WCB",
  "MNE",
  "CLC",
  "MCC",
  "WIS",
  "NOB",
  "GBO",
  "CPS",
  "CCG",
  "DEL",
  "RAP",
  "OSC",
  "BIR",
  "GRG",
  "CVL",
  "SDC",
  "SCW",
  "STO",
  "VAL",
  "RIP",
  "SLC",
  "OKL",
  "AUS",
  "TEX",
  "RGV",
  "MHU",
  "IWA",
  "SXF",
  "MXC",
  "GLI",
];
const API = "https://stats.nba.com/stats";
const aliases = new Map(
  Object.entries({
    "long island nets": "LIN",
    "westchester knicks": "WES",
    "windy city bulls": "WCB",
    "maine celtics": "MNE",
    "maine red claws": "MNE",
    "cleveland charge": "CLC",
    "canton charge": "CLC",
    "new mexico thunderbirds": "CLC",
    "albuquerque thunderbirds": "CLC",
    "huntsville flight": "CLC",
    "motor city cruise": "MCC",
    "northern arizona suns": "MCC",
    "bakersfield jam": "MCC",
    "wisconsin herd": "WIS",
    "noblesville boom": "NOB",
    "indiana mad ants": "NOB",
    "fort wayne mad ants": "NOB",
    "greensboro swarm": "GBO",
    "college park skyhawks": "CPS",
    "capital city go-go": "CCG",
    "delaware blue coats": "DEL",
    "delaware 87ers": "DEL",
    "raptors 905": "RAP",
    "osceola magic": "OSC",
    "lakeland magic": "OSC",
    "birmingham squadron": "BIR",
    "grand rapids gold": "GRG",
    "grand rapids drive": "GRG",
    "springfield armor": "GRG",
    "anaheim arsenal": "GRG",
    "coachella valley lakers": "CVL",
    "south bay lakers": "CVL",
    "los angeles d-fenders": "CVL",
    "los angeles dfenders": "CVL",
    "san diego clippers": "SDC",
    "ontario clippers": "SDC",
    "agua caliente clippers": "SDC",
    "santa cruz warriors": "SCW",
    "dakota wizards": "SCW",
    "stockton kings": "STO",
    "reno bighorns": "STO",
    "valley suns": "VAL",
    "rip city remix": "RIP",
    "salt lake city stars": "SLC",
    "idaho stampede": "SLC",
    "oklahoma city blue": "OKL",
    "tulsa 66ers": "OKL",
    "asheville altitude": "OKL",
    "austin spurs": "AUS",
    "austin toros": "AUS",
    "columbus riverdragons": "AUS",
    "texas legends": "TEX",
    "colorado 14ers": "TEX",
    "rio grande valley vipers": "RGV",
    "memphis hustle": "MHU",
    "iowa wolves": "IWA",
    "iowa energy": "IWA",
    "sioux falls skyforce": "SXF",
    "mexico city capitanes": "MXC",
    "g league ignite": "GLI",
    "nba g league ignite": "GLI",
    ignite: "GLI",
  }),
);
const abbr = new Map(
  Object.entries({
    LIN: "LIN",
    WES: "WES",
    WCB: "WCB",
    MNE: "MNE",
    CLC: "CLC",
    MCC: "MCC",
    WIS: "WIS",
    NOB: "NOB",
    GBO: "GBO",
    CPS: "CPS",
    CCG: "CCG",
    DEL: "DEL",
    RAP: "RAP",
    OSC: "OSC",
    BIR: "BIR",
    GRG: "GRG",
    CVL: "CVL",
    SBL: "CVL",
    LAD: "CVL",
    LDF: "CVL",
    SDC: "SDC",
    ONT: "SDC",
    ACC: "SDC",
    SCW: "SCW",
    DAK: "SCW",
    STO: "STO",
    RNB: "STO",
    VAL: "VAL",
    RIP: "RIP",
    SLC: "SLC",
    IDA: "SLC",
    OKL: "OKL",
    TUL: "OKL",
    AUS: "AUS",
    TEX: "TEX",
    RGV: "RGV",
    MHU: "MHU",
    IWA: "IWA",
    SXF: "SXF",
    MXC: "MXC",
    GLI: "GLI",
  }),
);
const mvp = {
  "2025-26": ["Mac McClung"],
  "2024-25": ["JD Davison"],
  "2023-24": ["Mac McClung"],
  "2022-23": ["Carlik Jones"],
  "2021-22": ["Trevelin Queen"],
  "2020-21": ["Paul Reed"],
  "2019-20": ["Frank Mason"],
  "2018-19": ["Chris Boucher"],
  "2017-18": ["Lorenzo Brown"],
  "2016-17": ["Vander Blue"],
  "2015-16": ["Jarnell Stokes"],
  "2014-15": ["Tim Frazier"],
  "2013-14": ["Ron Howard", "Othyus Jeffers"],
  "2012-13": ["Andrew Goudelock"],
  "2011-12": ["Justin Dentmon"],
  "2010-11": ["Curtis Stinson"],
  "2009-10": ["Mike Harris"],
  "2008-09": ["Courtney Sims"],
  "2007-08": ["Kasib Powell"],
  "2006-07": ["Randy Livingston"],
  "2005-06": ["Marcus Fizer"],
  "2004-05": ["Matt Carroll"],
  "2003-04": ["Tierre Brown"],
  "2002-03": ["Devin Brown"],
  "2001-02": ["Ansu Sesay"],
};
const norm = (s) =>
  String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);
const first = (r, ...ks) => {
  for (const k of ks)
    if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k];
  return null;
};
const round = (x, d = 1) => Math.round(num(x) * 10 ** d) / 10 ** d;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function rows(json) {
  const set = Array.isArray(json?.resultSets)
    ? json.resultSets[0]
    : json?.resultSet || json?.resultSets;
  if (!set) return [];
  return (set.rowSet || []).map((v) =>
    Object.fromEntries((set.headers || []).map((h, i) => [h, v[i]])),
  );
}
async function api(endpoint, params, optional = false) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) url.searchParams.set(k, String(v ?? ""));
  let last;
  for (let a = 1; a <= 6; a++) {
    try {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 45000),
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 AppleWebKit/537.36 Chrome/124 Safari/537.36",
            Accept: "application/json, text/plain, */*",
            Origin: "https://www.nba.com",
            Referer: "https://www.nba.com/",
          },
        });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`${response.status}`);
      const result = rows(await response.json());
      if (!result.length && !optional) throw new Error("empty");
      return result;
    } catch (e) {
      last = e;
      await sleep(700 * a * a);
    }
  }
  if (optional) {
    console.warn(`${endpoint} optional failure`, last);
    return [];
  }
  throw new Error(`${endpoint}: ${last}`);
}
const common = (season, league = "20") => ({
  Conference: "",
  Country: "",
  DateFrom: "",
  DateTo: "",
  Division: "",
  DraftPick: "",
  DraftYear: "",
  GameScope: "",
  GameSegment: "",
  Height: "",
  LastNGames: 0,
  LeagueID: league,
  Location: "",
  MeasureType: "Base",
  Month: 0,
  OpponentTeamID: 0,
  Outcome: "",
  PORound: 0,
  PaceAdjust: "N",
  PerMode: "PerGame",
  Period: 0,
  PlayerExperience: "",
  PlayerPosition: "",
  PlusMinus: "N",
  Rank: "N",
  Season: season,
  SeasonSegment: "",
  SeasonType: "Regular Season",
  ShotClockRange: "",
  StarterBench: "",
  TeamID: 0,
  VsConference: "",
  VsDivision: "",
  Weight: "",
});
function teamCode(name, short, season) {
  const key = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (key === "erie bayhawks") {
    const y = +season.slice(0, 4);
    return y <= 2016 ? "OSC" : y <= 2018 ? "CPS" : "BIR";
  }
  return (
    aliases.get(key) || abbr.get(String(short || "").toUpperCase()) || null
  );
}
function positions(h, ast, reb, blk, listed = "") {
  const p = String(listed).toUpperCase();
  if (p.includes("C") || h >= 82 || (reb >= 8 && blk >= 1.3))
    return ["PF", "C"];
  if (p.includes("G") || (h && h <= 77) || ast >= 4.5) return ["PG", "SG"];
  if (h && h <= 80) return ["SG", "SF"];
  if (p.includes("F") || h >= 79) return ["SF", "PF"];
  return ast >= 3.5 ? ["PG", "SG"] : reb >= 6 ? ["SF", "PF"] : ["SG", "SF"];
}
function nbaBonus(g) {
  if (g >= 800) return16;
  if (g >= 600) return14;
  if (g >= 400) return12;
  if (g >= 300) return11;
  if (g >= 200) return9;
  if (g >= 100) return7;
  if (g >= 50) return5;
  if (g >= 10) return3;
  if (g >= 1) return1;
  return0;
}
function draftBonus(p) {
  if (!p) return0;
  if (p <= 5) return9;
  if (p <= 14) return7;
  if (p <= 30) return4;
  if (p <= 60) return2;
  return0;
}
function rate(c, g) {
  let s =
    58 +
    c.ppg * 0.55 +
    c.rpg * 0.3 +
    c.apg * 0.45 +
    c.spg * 1.15 +
    c.bpg +
    Math.max(
      -3,
      Math.min(
        4,
        (c.fgPct - 0.44) * 24 + (c.threePct - 0.34) * 8 + (c.ftPct - 0.74) * 3,
      ),
    ) +
    Math.min(4, c.gp / 9) +
    nbaBonus(c.nbaGames) +
    draftBonus(c.draftPick) +
    Math.min(4, Math.sqrt(g) / 5);
  if (c.accolades.some((a) => a.includes("MVP"))) s += 8;
  if (c.accolades.some((a) => a.includes("Rookie"))) s += 4;
  if (c.accolades.some((a) => a.includes("Defensive"))) s += 5;
  if (c.accolades.some((a) => a.includes("leader"))) s += 2;
  let o = Math.round(Math.max(60, Math.min(97, s)));
  if (c.name === "Mac McClung" && ["2023-24", "2025-26"].includes(c.season))
    o = Math.max(95, o);
  return o;
}
const tier = (o) =>
  o >= 95
    ? "Apex"
    : o >= 90
      ? "Icon"
      : o >= 83
        ? "Diamond"
        : o >= 77
          ? "Pulse"
          : o >= 70
            ? "Alloy"
            : "Slate";
async function awards() {
  const map = new Map();
  for (const [s, names] of Object.entries(mvp))
    for (const name of names)
      map.set(`${s}|${norm(name)}`, ["NBA G League MVP"]);
  for (const [slug, label] of [
    ["mvp", "NBA G League MVP"],
    ["dpoy", "NBA G League Defensive Player of the Year"],
    ["roy", "NBA G League Rookie of the Year"],
    ["mip", "NBA G League Most Improved Player"],
  ])
    try {
      const res = await fetch(
          `https://www.basketball-reference.com/gleague/awards/${slug}.html`,
          { headers: { "User-Agent": "Mozilla/5.0" } },
        ),
        html = await res.text(),
        rx =
          /<tr[^>]*>[\s\S]*?data-stat="season"[^>]*>(?:<a[^>]*>)?\s*([^<]+)[\s\S]*?data-stat="player"[^>]*>(?:<a[^>]*>)?\s*([^<]+)[\s\S]*?<\/tr>/gi;
      for (const m of html.matchAll(rx)) {
        const s = m[1].trim(),
          name = m[2].trim(),
          k = `${s}|${norm(name)}`,
          list = map.get(k) || [];
        if (/^20\d\d-\d\d$/.test(s) && name && !list.includes(label)) {
          list.push(label);
          map.set(k, list);
        }
      }
    } catch (e) {
      console.warn("award source", slug, e);
    }
  return map;
}
async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const awardMap = await awards(),
    nbaGames = new Map();
  for (const season of SEASONS) {
    console.log("NBA career pass", season);
    const rs = await api("leaguedashplayerstats", common(season, "00"), true);
    for (const r of rs) {
      const id = String(first(r, "PLAYER_ID") || "");
      if (id) nbaGames.set(id, (nbaGames.get(id) || 0) + num(first(r, "GP")));
    }
  }
  const cards = [],
    coverage = [],
    lineage = new Map();
  for (const season of SEASONS) {
    console.log("G League", season);
    let teams;
    try {
      teams = await api("leaguedashteamstats", common(season));
    } catch (e) {
      coverage.push({ season, status: "missing", teams: 0, cards: 0 });
      continue;
    }
    const mapped = [];
    for (const t of teams) {
      const id = String(first(t, "TEAM_ID") || ""),
        name = String(first(t, "TEAM_NAME") || ""),
        short = String(first(t, "TEAM_ABBREVIATION") || ""),
        code = teamCode(name, short, season) || lineage.get(id);
      if (code) {
        lineage.set(id, code);
        mapped.push({ id, name, code });
      }
    }
    const bios = await api(
        "leaguedashplayerbiostats",
        { ...common(season), MeasureType: undefined },
        true,
      ),
      bioById = new Map(
        bios.map((b) => [String(first(b, "PLAYER_ID") || ""), b]),
      );
    let count = 0;
    for (const t of mapped) {
      await sleep(170);
      let players;
      try {
        players = await api("leaguedashplayerstats", {
          ...common(season),
          TeamID: t.id,
        });
      } catch {
        continue;
      }
      for (const r of players) {
        const id = String(first(r, "PLAYER_ID") || ""),
          name = String(first(r, "PLAYER_NAME") || "").trim();
        if (!id || !name) continue;
        const b = bioById.get(id) || {},
          h = num(first(b, "PLAYER_HEIGHT_INCHES")),
          pick = num(first(b, "DRAFT_NUMBER")),
          card = {
            id: `${t.code}-${season}-${id}`,
            playerId: id,
            name,
            season,
            teamCode: t.code,
            teamName: t.name,
            gp: num(first(r, "GP")),
            mpg: round(first(r, "MIN")),
            ppg: round(first(r, "PTS")),
            rpg: round(first(r, "REB")),
            apg: round(first(r, "AST")),
            spg: round(first(r, "STL")),
            bpg: round(first(r, "BLK")),
            tov: round(first(r, "TOV")),
            fgPct: round(first(r, "FG_PCT"), 3),
            threePct: round(first(r, "FG3_PCT"), 3),
            ftPct: round(first(r, "FT_PCT"), 3),
            plusMinus: round(first(r, "PLUS_MINUS")),
            age: round(first(r, "AGE"), 1),
            heightInches: h,
            height: h ? `${Math.floor(h / 12)}'${h % 12}\"` : null,
            weightLbs: num(first(b, "PLAYER_WEIGHT")) || null,
            college: first(b, "COLLEGE") || null,
            country: first(b, "COUNTRY") || null,
            draftYear: num(first(b, "DRAFT_YEAR")) || null,
            draftRound: num(first(b, "DRAFT_ROUND")) || null,
            draftPick: pick || null,
            nbaGames: nbaGames.get(id) || 0,
            accolades: [...(awardMap.get(`${season}|${norm(name)}`) || [])],
            headshotUrl: `https://ak-static.cms.nba.com/wp-content/uploads/headshots/gleague/260x190/${id}.png`,
            sourceLabel: "NBA G League official statistics",
          };
        card.positions = positions(
          h,
          card.apg,
          card.rpg,
          card.bpg,
          first(b, "PLAYER_POSITION"),
        );
        cards.push(card);
        count++;
      }
    }
    coverage.push({
      season,
      status: count ? "ok" : "missing",
      teams: mapped.length,
      cards: count,
    });
  }
  for (const season of SEASONS) {
    const pool = cards.filter((c) => c.season === season && c.gp >= 10);
    for (const [field, label] of [
      ["ppg", "G League scoring leader"],
      ["rpg", "G League rebounding leader"],
      ["apg", "G League assists leader"],
    ])
      if (pool.length) {
        const max = Math.max(...pool.map((c) => c[field]));
        for (const c of pool.filter((c) => c[field] === max))
          c.accolades.push(label);
      }
  }
  const career = new Map();
  for (const c of cards)
    career.set(c.playerId, (career.get(c.playerId) || 0) + c.gp);
  for (const c of cards) {
    c.gleagueCareerGames = career.get(c.playerId);
    c.overall = rate(c, c.gleagueCareerGames);
    c.tier = tier(c.overall);
  }
  cards.sort(
    (a, b) =>
      a.teamCode.localeCompare(b.teamCode) ||
      b.season.localeCompare(a.season) ||
      b.overall - a.overall,
  );
  const counts = Object.fromEntries(
      TEAM_CODES.map((code) => [
        code,
        cards.filter((c) => c.teamCode === code).length,
      ]),
    ),
    missingTeams = TEAM_CODES.filter((c) => !counts[c]),
    missingSeasons = coverage
      .filter((c) => c.status !== "ok")
      .map((c) => c.season),
    generatedAt = new Date().toISOString(),
    complete = !missingTeams.length && !missingSeasons.length,
    payload = {
      generatedAt,
      complete,
      source:
        "Official NBA and NBA G League historical statistics plus award histories",
      dataCutoff: "2026-07-30",
      seasons: SEASONS,
      missingSeasons,
      missingTeams,
      counts,
      seasonCoverage: coverage,
      cards,
    };
  fs.writeFileSync(OUT, `window.GLEAGUE_DATA=${JSON.stringify(payload)};\n`);
  fs.writeFileSync(
    SUMMARY,
    JSON.stringify(
      {
        generatedAt,
        complete,
        totalCards: cards.length,
        counts,
        missingTeams,
        missingSeasons,
        coverage,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${cards.length} cards; complete=${complete}`);
  if (cards.length < 500) process.exit(2);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
