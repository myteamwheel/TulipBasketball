"""Who owns every 2027-2029 rookie pick in all six leagues today, and what each is worth in context (values.py)."""
import json, os
import pandas as pd
from common import *
import values as VAL

spots = pd.read_parquet(os.path.join(OUT, "roster_spots.parquet"))
fp = []
for label, lid, f in LEAGUES:
    L = json.load(open(os.path.join(RAW, "sleeper", "current", f"league_{lid}.json")))
    Rr = json.load(open(os.path.join(RAW, "sleeper", "current", f"rosters_{lid}.json")))
    TP = json.load(open(os.path.join(RAW, "sleeper", "current", f"traded_picks_{lid}.json")))
    owner = {(p["season"], p["round"], p["roster_id"]): p["owner_id"] for p in TP}
    team = spots[spots.league == label].drop_duplicates("roster_id").set_index("roster_id").team.to_dict()
    mine = next((r["roster_id"] for r in Rr if r.get("owner_id") == ME), None)
    for season in ("2027", "2028", "2029"):
        for rd in range(1, L["settings"]["draft_rounds"] + 1):
            for r in Rr:
                o = owner.get((season, rd, r["roster_id"]), r["roster_id"])
                v, basis = VAL.pick_value_at(label, int(season), rd, r["roster_id"], VAL.NOW)
                fp.append(dict(league=label, season=int(season), round=rd, original_roster_id=r["roster_id"], original_team=team.get(r["roster_id"]), owner_roster_id=o,
                               owner_team=team.get(o), brett_owns=o == mine, traded=o != r["roster_id"], value_today=round(v, 1), value_basis=basis))
FP = pd.DataFrame(fp)
FP.to_parquet(os.path.join(OUT, "future_picks.parquet"))
print("future picks:", len(FP), "| Brett owns:", FP.groupby("league").brett_owns.sum().to_dict())
