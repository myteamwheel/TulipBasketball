"""Rebuild the original research engine; publish only league-scoped results.

Use --cached only for regression checks. The scheduled workflow always fetches
fresh source inputs and never publishes a cached-input build.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import urllib.request

HERE = Path(__file__).resolve().parent

def download(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "dynasty-bois-audit"})
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read()
    if not body:
        raise RuntimeError(f"Empty required source: {url}")
    temporary = target.with_suffix(target.suffix + ".download")
    temporary.write_bytes(body)
    temporary.replace(target)

def run_module(name):
    subprocess.run([sys.executable, str(HERE / "portfolio" / f"{name}.py")], check=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cached", action="store_true")
    parser.add_argument("--previous", type=Path)
    args = parser.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    # The inherited analysis names the 2025 baseline and 2026 rookie class.
    # Fail visibly at rollover instead of publishing a mislabeled future audit.
    if now.year != 2026:
        raise RuntimeError("The original audit's season baseline needs its annual rollover before publication.")
    work = args.work_dir.resolve()
    for folder in ("raw/sleeper", "raw/market", "raw/nflverse", "out", "reference", "report"):
        (work / folder).mkdir(parents=True, exist_ok=True)
    os.environ["AUDIT_WORK_DIR"] = str(work)
    os.environ["AUDIT_AS_OF"] = now.isoformat()
    if not args.cached:
        base = "https://github.com/nflverse/nflverse-data/releases/download/"
        for remote, filename in [("draft_picks/draft_picks.parquet", "draft_picks.parquet"), ("combine/combine.parquet", "combine.parquet"), ("injuries/injuries_2025.parquet", "injuries_2025.parquet")]:
            target = work / "reference" / filename
            if not target.exists(): download(base + remote, target)
        for year in range(1999, 2026):
            for frequency in ("reg", "week"):
                if frequency == "week" and year < 2020: continue
                filename = f"stats_player_{frequency}_{year}.parquet"
                target = work / "reference" / filename
                if not target.exists(): download(base + "stats_player/" + filename, target)
        download("https://api.sleeper.app/v1/players/nfl", work / "raw/sleeper/players_nfl.json")
        for module in ("fetch_rosters", "fetch_history", "fetch_market", "fetch_value_history", "fetch_history2"):
            run_module(module)
    run_module("fetch_titles")
    for module in ("build_players", "build_master", "build_acquisitions", "analyze_core", "analyze_extra", "analyze_more", "analyze_last", "build_stints", "enrich_hist", "build_hist_tables", "analyze_hist", "combine_analysis", "trade_ledger", "trade_features", "trade_patterns", "trends", "build_future_picks"):
        run_module(module)

    # Recommendations follow recalculated evidence, rather than repeating the
    # original report's fixed September 23 conclusions indefinitely.
    patterns = json.loads((work / "out/analysis_patterns.json").read_text())
    tags = [row for row in patterns["tags_bois"] if row["b_n"] >= 5]
    recommendations = []
    for action, rows in (("Review", sorted(tags, key=lambda r: r["b_net"])[:5]), ("Keep researching", sorted(tags, key=lambda r: -r["b_net"])[:5])):
        for rank, row in enumerate(rows, 1):
            recommendations.append(dict(scope="Dynasty Bois", action=action, rank=rank, headline=row["tag"], evidence=f'{int(row["b_n"])} trades; {int(row["b_w"])} wins, {int(row["b_l"])} losses; context-adjusted net value {row["b_net"]:,.0f}. Descriptive historical evidence; overlapping groups are not independent.'))
    (work / "out/recommendations.json").write_text(json.dumps(recommendations))
    sys.path.insert(0, str(HERE / "portfolio"))
    registry = runpy.run_path(str(HERE / "portfolio/tables.py"))
    tables = registry["bois_view"](registry["TABLES"])
    workbook_tables = [table for table in tables if not table["big"]]
    if len(workbook_tables) < 70:
        raise RuntimeError(f"Research table coverage fell unexpectedly: {len(workbook_tables)}")
    spots = next(t["df"] for t in tables if t["name"] == "current_roster_spots")
    if spots.roster_id.nunique() != 12 or spots[spots.is_me].empty:
        raise RuntimeError("League roster validation failed")
    def records(frame):
        return json.loads(frame.to_json(orient="records", date_format="iso", double_precision=6))
    data = dict(version=1, leagueId="1312155271526625280", generatedAt=now.isoformat(), freshInputs=not args.cached, collegeBaseline="2026-08-19", tables=[])
    data["tables"].append(dict(name="Dictionary", report="Reference", kind="reference", description="Original column meanings and source data types", rows=records(registry["dictionary"](workbook_tables))))
    for table in workbook_tables:
        data["tables"].append(dict(name=table["name"], report=registry["REP_LABEL"][table["report"]], kind=table["kind"], description=table["desc"], rows=records(table["df"])))
    previous = json.loads(gzip.decompress(args.previous.read_bytes())) if args.previous else None
    old = {table["name"]: table for table in previous["tables"]} if previous else {}
    changes = []
    for table in data["tables"]:
        prior = old.get(table["name"])
        def row_hashes(rows): return {hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest() for row in rows}
        before, after = row_hashes(prior["rows"] if prior else []), row_hashes(table["rows"])
        if before != after:
            changes.append(dict(table=table["name"], previousRows=len(prior["rows"]) if prior else None, currentRows=len(table["rows"]), addedOrChanged=len(after-before), removedOrChanged=len(before-after)))
    data["changes"] = changes
    data["comparedWith"] = previous["generatedAt"] if previous else None
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "tables.json.gz").write_bytes(gzip.compress(json.dumps(data, allow_nan=False, separators=(",", ":")).encode()))
    subprocess.run(["node", str(HERE / "workbook.mjs"), str(args.output_dir)], check=True)
    subprocess.run([sys.executable, str(HERE / "report.py"), str(args.output_dir)], check=True)
    files = {name: dict(bytes=(args.output_dir/name).stat().st_size, sha256=hashlib.sha256((args.output_dir/name).read_bytes()).hexdigest()) for name in ("tables.json.gz", "Dynasty-Bois-Data.xlsx", "Dynasty-Bois-Report.pdf")}
    (args.output_dir / "manifest.json").write_text(json.dumps(dict(generatedAt=data["generatedAt"], freshInputs=data["freshInputs"], leagueId=data["leagueId"], tableCount=len(data["tables"]), comparedWith=data["comparedWith"], changes=changes, files=files), indent=2))

if __name__ == "__main__": main()
