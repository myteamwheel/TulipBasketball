"""Attributes for every player who appears anywhere in the leagues' histories + a long table of monthly values (players and picks)."""
import json, os, re, glob
import numpy as np, pandas as pd
from common import *
from colleges import classify

S = pd.read_parquet(os.path.join(OUT, "stints.parquet"))
FC = pd.read_parquet(os.path.join(OUT, "failed_claims.parquet"))
ids_all = sorted(set(S.player_id) | set(FC.player_id))
SL = json.load(open(os.path.join(RAW, "sleeper", "players_nfl.json")))
db = pd.read_csv(os.path.join(RAW, "market", "db_playerids.csv"), dtype=str)
db = db[db.sleeper_id.notna() & (db.sleeper_id != "NA")].drop_duplicates("sleeper_id").set_index("sleeper_id")
nv = pd.read_parquet(os.path.join(RAW, "nflverse", "players.parquet")).drop_duplicates("gsis_id").set_index("gsis_id")
dp = pd.read_parquet(os.path.join(BRETT_RAW, "draft_picks.parquet"))
clean = lambda x: None if x is None or (isinstance(x, float) and np.isnan(x)) or str(x).strip() in ("", "NA", "None", "nan") else str(x).strip()
num = lambda x: pd.to_numeric(x, errors="coerce")
rows = []
for pid in ids_all:
    p = SL.get(pid, {}); d = db.loc[pid] if pid in db.index else None
    g = clean(p.get("gsis_id")) or (clean(d["gsis_id"]) if d is not None else None)
    n = nv.loc[g] if g is not None and g in nv.index else None
    name = p.get("full_name") or (d["name"] if d is not None else None) or (n["display_name"] if n is not None else pid)
    pos = p.get("position") or (d["position"] if d is not None else None) or (n["position"] if n is not None else None)
    bd = (n["birth_date"] if n is not None and clean(n["birth_date"]) else None) or p.get("birth_date") or (clean(d["birthdate"]) if d is not None else None)
    dr_round = num(n["draft_round"]) if n is not None else np.nan
    dr_pick = num(n["draft_pick"]) if n is not None else np.nan
    dr_year = num(n["draft_year"]) if n is not None else np.nan
    if pd.isna(dr_round) and d is not None:
        dr_round, dr_pick, dr_year = num(clean(d["draft_round"])), num(clean(d["draft_ovr"])), num(clean(d["draft_year"]))
    rookie = num(n["rookie_season"]) if n is not None else np.nan
    if pd.isna(rookie) or rookie < 1990:
        ry = num((p.get("metadata") or {}).get("rookie_year"))
        rookie = ry if pd.notna(ry) and ry > 1990 else (dr_year if pd.notna(dr_year) else (2026 - num(p.get("years_exp")) if p.get("years_exp") is not None else np.nan))
    col = (n["college_name"] if n is not None and clean(n["college_name"]) else None) or p.get("college") or (clean(d["college"]) if d is not None else None)
    rows.append(dict(player_id=pid, name=name, pos=pos, birth_date=bd, draft_year=dr_year, draft_round=dr_round, draft_pick=dr_pick, rookie_season=rookie,
                     college=col, gsis_id=g, fp_id=clean(d["fantasypros_id"]) if d is not None else None))
PH = pd.DataFrame(rows)
# name fallback for draft info
norm = lambda x: re.sub(r"[^a-z]", "", str(x).lower().replace(" jr.", "").replace(" iii", "").replace(" ii", ""))
dpn = dp.assign(k=dp.pfr_player_name.map(norm))
for i in PH.index[PH.draft_round.isna()]:
    ry = PH.at[i, "rookie_season"]
    m = dpn[(dpn.k == norm(PH.at[i, "name"])) & (dpn.season.between((ry if pd.notna(ry) else 2030) - 1, ry if pd.notna(ry) else 2030))]
    if len(m) == 1:
        PH.loc[i, ["draft_year", "draft_round", "draft_pick"]] = [m.season.iloc[0], m["round"].iloc[0], m.pick.iloc[0]]
PH["birth_date"] = pd.to_datetime(PH.birth_date, errors="coerce")
PH["drafted"] = PH.draft_round.notna()
PH["capital"] = np.where(~PH.drafted, "UDFA", np.where(PH.draft_round == 1, np.where(PH.draft_pick <= 10, "R1 top-10", "R1 11-32"), "R" + PH.draft_round.fillna(0).astype(int).astype(str)))
PH["college_final"] = PH.college.map(lambda c: c.split(";")[0].strip() if isinstance(c, str) else None)
PH["final_college_season"] = PH.draft_year.fillna(PH.rookie_season) - 1
C = PH.apply(lambda r: pd.Series(classify(r.college_final, r.final_college_season)), axis=1)
PH = pd.concat([PH, C.rename(columns={"level": "college_level", "tier": "conf_tier"})], axis=1)
PH.to_parquet(os.path.join(OUT, "players_hist.parquet"))
print("players in history:", len(PH), "| coverage: birth", f"{PH.birth_date.notna().mean():.1%}", "rookie", f"{PH.rookie_season.notna().mean():.1%}",
      "school", f"{PH.school.notna().mean():.1%}", "fp_id", f"{PH.fp_id.notna().mean():.1%}", "| unmapped schools:", sorted(set(PH.college_final[PH.conf == "UNMAPPED"]))[:40])
print(PH.pos.value_counts().to_dict())

# long table of monthly values (players + picks)
L = []
for f in sorted(glob.glob(os.path.join(RAW, "market", "dp_values_history", "dpv_*.csv"))):
    d = pd.read_csv(f, encoding="utf-8-sig", dtype={"fp_id": str})
    d["date"] = pd.Timestamp(os.path.basename(f)[4:14])
    keep = [c for c in ["player", "pos", "fp_id", "value_1qb", "value_2qb", "date"] if c in d]
    L.append(d[keep])
DL = pd.concat(L, ignore_index=True)
DL.to_parquet(os.path.join(OUT, "dp_long.parquet"))
print("value rows:", len(DL), "| snapshots:", DL.date.nunique(), "| pick rows:", int((DL.pos == "PICK").sum()))
print(DL[DL.pos == "PICK"].groupby("date").player.apply(lambda s: sorted(set(s.str.extract(r"^(\d{4})")[0]))).iloc[[0, 12, 30, -1]].to_dict())
