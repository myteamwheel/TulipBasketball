"""Market + in-season NFL downloads (FantasyCalc documented endpoint, DynastyProcess, nflverse). FantasyCalc asks for <= 1 refresh per hour."""
import os, urllib.request
from common import *
M, NV = os.path.join(RAW, "market"), os.path.join(RAW, "nflverse")
def dl(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (dynasty-portfolio; personal analysis)"})
    with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f: f.write(r.read())
    print("saved", os.path.basename(path))
FC = {"bois": (2, 12, 0.5, "none"), "nowl": (1, 14, 1, "te%2B%2B"), "awesome": (2, 10, 1, "none"), "brokeback": (2, 12, 1, "none"),
      "bigshow": (1, 14, 1, "te%2B"), "maxxing": (2, 10, 1, "te%2B"), "sf12": (2, 12, 1, "none"), "1qb12": (1, 12, 1, "none")}
for k, (q, t, p, tep) in FC.items():
    dl(f"https://api.fantasycalc.com/values/current?isDynasty=true&numQbs={q}&numTeams={t}&ppr={p}&tep={tep}", os.path.join(M, f"fc_{k}.json"))
for f in ["values-players.csv", "values-picks.csv", "db_playerids.csv"]:
    dl(f"https://raw.githubusercontent.com/dynastyprocess/data/master/files/{f}", os.path.join(M, f))
for u in ["stats_player/stats_player_week_2026.parquet", "snap_counts/snap_counts_2026.parquet", "depth_charts/depth_charts_2026.parquet",
          "players/players.parquet", "injuries/injuries_2026.parquet", "weekly_rosters/roster_weekly_2025.parquet", "weekly_rosters/roster_weekly_2026.parquet"]:
    dl(f"https://github.com/nflverse/nflverse-data/releases/download/{u}", os.path.join(NV, os.path.basename(u)))
