"""Collect completed Sleeper draft boards and dated Superflex KTC observations.
Run from the repository root. A failed download never replaces the existing file.
"""
import argparse
import csv
import io
import json
import re
import subprocess
import tempfile
from threading import get_ident
import unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

OUT = Path("src/data/draft-selections.json")
ARCHIVE = "https://docs.google.com/spreadsheets/d/1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs/export?format=csv&gid=991742784"
LEGACY = "https://raw.githubusercontent.com/G-Sher/dynasty-daddy/main/data/datasource.csv"
API = "https://api.sleeper.app/v1/"
args = argparse.ArgumentParser()
args.add_argument("--cache", help="Reuse downloads in this directory for a single collection")
cache = Path(args.parse_args().cache or tempfile.mkdtemp())
cache.mkdir(parents=True, exist_ok=True)
today = datetime.now(timezone.utc).date()

def download(key, url):
    path = cache / key
    if not path.exists():
        temp = path.with_name(key+"."+str(get_ident())+".download")
        subprocess.run(["curl", "-fsSL", "--compressed", "--retry", "2", "--max-time", "90", url, "-o", str(temp)], check=True)
        temp.replace(path)
    return path.read_text()

def api(key, route):
    return json.loads(download(key, API + route))

def norm(name):
    text = "".join(c for c in unicodedata.normalize("NFD", name.lower()) if not unicodedata.combining(c))
    return re.sub("[^a-z0-9]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", text))

def index_by(rows, key):
    result = defaultdict(list)
    for row in rows:
        result[key(row)].append(row)
    return result

def one(items):
    return items[0] if len(items) == 1 else None

def ktc(value):
    if value is None or value == "":
        return None
    value = int(str(value).replace(",", ""))
    if not 0 <= value <= 9999:
        return None
    return value

def series_value(series, target, window):
    if target > today:
        return None
    for age in range(window + 1):
        day = (target - timedelta(days=age)).isoformat()
        if series.get(day) is not None:
            return {"date": day, "value": series[day]}
    return None

root = re.search(r'SLEEPER_LEAGUE_ID = "(\d+)"', Path("src/lib/config.ts").read_text())[1]
board = download("catalog", "https://keeptradecut.com/dynasty/power-rankings/players?leagueId=" + root + "&platform=Sleeper")
catalog = json.JSONDecoder().raw_decode(board[re.search(r"var playersArray\s*=\s*", board).end():])[0]
board_date = datetime.fromtimestamp(int(re.search(r"lastUpdatedMilliseconds\s*=\s*(\d+)", board)[1])/1000, timezone.utc).date()
if len(catalog) < 800 or not 0 <= (today-board_date).days <= 7:
    raise ValueError("Incomplete or outdated KTC catalog")
by_name = index_by(catalog, lambda p: (norm(p["playerName"]), p["position"]))
by_id = {str(p["playerID"]): p for p in catalog}
overrides = dict(re.findall(r'sleeperId: "(\d+)".*?ktcId: "(\d+)"', Path("src/lib/ktcIdentityOverrides.ts").read_text()))
sheet = list(csv.reader(io.StringIO(download("sf.csv", ARCHIVE))))
assert sheet[0][0] == "Date" and len(sheet) > 1000
columns = index_by(range(1,len(sheet[0])), lambda i: norm(sheet[0][i]))
daily = {row[0]: row for row in sheet[1:]}
early = defaultdict(dict)
for row in csv.reader(io.StringIO(download("testcsv", LEGACY))):
    if row[2] and row[7] in ("QB","RB","WR","TE"):
        early[row[2]][row[13][:10]] = ktc(row[11])

drafts, stats, scoring = [], {}, {}
league_id = root
seen = set()
while league_id:
    if league_id in seen:
        raise ValueError("Circular Sleeper history")
    seen.add(league_id)
    league = api("league-"+league_id, "league/"+league_id)
    year = league["season"]
    scoring[year] = league["scoring_settings"]
    stats[year] = api("stats"+year, "stats/nfl/regular/"+year)
    assert len(stats[year]) > 100
    users = {u["user_id"]: u for u in api(year+"users", "league/"+league_id+"/users")}
    for draft in api("drafts-"+league_id, "league/"+league_id+"/drafts"):
        if draft["status"] != "complete" or draft["type"] == "auction":
            continue
        did = draft["draft_id"]
        picks = api("picks-"+did, "draft/"+did+"/picks")
        assert picks and len({p["pick_no"] for p in picks}) == len(picks)
        start = datetime.fromtimestamp(draft["start_time"]/1000, timezone.utc).date()
        if start.month >= 9:
            raise ValueError("In-season draft requires weekly rather than seasonal points")
        drafts.append((year,draft,start,users,picks))
    league_id = league.get("previous_league_id")

def collect(job):
    year, draft, start, users, pick = job
    meta, pid = pick["metadata"], pick["player_id"]
    owner = pick.get("picked_by") or None
    user = users.get(owner) or {}
    name = (meta["first_name"]+" "+meta["last_name"]).strip()
    player = by_id.get(overrides.get(pid)) or one(by_name[(norm(name),meta["position"])])
    col = one(columns[norm(player["playerName"] if player else name)])
    series = dict(early.get(pid, {}))
    if col:
        for day, row in daily.items():
            if col < len(row) and row[col]:
                series[day] = ktc(row[col])
    anniversary = start + timedelta(days=730) if start.month == 2 and start.day == 29 else start.replace(year=start.year+2)
    before = start-timedelta(days=1)
    profile = "https://keeptradecut.com/dynasty-rankings/players/"+player["slug"] if player else None
    if player and (not series_value(series,before,0) or (anniversary <= today and not series_value(series,anniversary,0)) or not series_value(series,today,1)):
        try:
            text = download("profile-"+str(player["playerID"]), profile)
        except subprocess.CalledProcessError:
            text = ""
        identity = re.search(r"var player = (\{[^\n]+\});",text)
        chart = re.search(r'<script[^>]+id="pd-superflex"[^>]*>([\s\S]*?)</script>',text)
        if identity and json.loads(identity[1])["playerID"] == player["playerID"] and chart:
            for pt in json.loads(chart[1])["overallValue"]:
                d = pt["d"]
                series["20"+d[:2]+"-"+d[2:4]+"-"+d[4:]] = ktc(pt["v"])
    now = series_value(series,today,7)
    if player and (not now or board_date.isoformat() > now["date"]):
        value = ktc(player["superflexValues"]["value"])
        if value is not None:
            now = {"value": value, "date": board_date.isoformat()}
    points, games = 0, 0
    for season in stats:
        if season < year:
            continue
        line = stats[season].get(pid,{})
        gp = int(line.get("gp",0))
        if gp:
            games += gp
            points += sum(line.get(k,0)*v for k,v in scoring[season].items())
    return dict(id=draft["draft_id"]+"-"+str(pick["pick_no"]),draft=draft["draft_id"],year=int(year),auction=draft["type"]=="auction",
                start=start.isoformat(),overall=pick["pick_no"],round=pick["round"],teams=draft["settings"]["teams"],
                bid=int(meta["amount"]) if draft["type"]=="auction" else None,playerId=pid,name=name,pos=meta["position"],
                owner=owner,manager=user.get("display_name") or owner,team=(user.get("metadata") or {}).get("team_name"),
                profile=profile,at=series_value(series,before,7),two=series_value(series,anniversary,14),due=anniversary.isoformat(),
                now=now,games=games,points=round(points,2))
jobs = [(year,d,start,users,p) for year,d,start,users,picks in drafts for p in picks]
# One job per selection. A player can be drafted twice; use independent temporary files for concurrent downloads.
with ThreadPoolExecutor(max_workers=4) as pool:
    selections = list(pool.map(collect,jobs))
previous = json.loads(OUT.read_text())["picks"] if OUT.exists() else []
old_ids = {p["id"] for p in previous if not p["auction"]}
if not old_ids.issubset({p["id"] for p in selections}):
    raise ValueError("Previous selections missing; retaining prior archive")
result = {"checked":today.isoformat(),"picks":selections}
temp = OUT.with_suffix(".tmp")
temp.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":"))+"\n")
temp.replace(OUT)
print(len(selections),"picks;",sum(p["at"] is not None for p in selections),"entry quotes;",sum(p["two"] is not None for p in selections),"two-year quotes;",sum(p["now"] is not None for p in selections),"current quotes")
