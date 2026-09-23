"""Step 1: roster spots for every team in the six leagues + player attribute join (IDs, bio, draft, college)."""
import json, os, re
import numpy as np, pandas as pd
from common import *

TODAY = pd.Timestamp(AS_OF_DATE)
cur = os.path.join(RAW, "sleeper", "current")
S = json.load(open(os.path.join(RAW, "sleeper", "players_nfl.json")))

# ---------- roster spots (all teams, all six leagues) ----------
rows = []
for label, lid, fmt in LEAGUES:
    users = {u["user_id"]: u for u in json.load(open(os.path.join(cur, f"users_{lid}.json")))}
    for r in json.load(open(os.path.join(cur, f"rosters_{lid}.json"))):
        u = users.get(r.get("owner_id"), {})
        team = ((u.get("metadata") or {}).get("team_name") or u.get("display_name") or f"roster {r['roster_id']}").strip()
        starters, taxi, ir = set(r.get("starters") or []), set(r.get("taxi") or []), set(r.get("reserve") or [])
        for pid in r.get("players") or []:
            slot = "ir" if pid in ir else "taxi" if pid in taxi else "starter" if pid in starters else "bench"
            rows.append(dict(league=label, league_id=lid, roster_id=r["roster_id"], owner_id=r.get("owner_id"),
                             team=team, is_me=r.get("owner_id") == ME, sleeper_id=pid, slot=slot, **{f"fmt_{k}": v for k, v in fmt.items()}))
spots = pd.DataFrame(rows)
spots.to_parquet(os.path.join(OUT, "roster_spots.parquet"))
print("roster spots:", len(spots), "| mine:", spots.is_me.sum(), "| unique players:", spots.sleeper_id.nunique(), "| mine unique:", spots[spots.is_me].sleeper_id.nunique())

# ---------- player attributes ----------
ids = pd.read_csv(os.path.join(RAW, "market", "db_playerids.csv"), dtype=str)
ids = ids[ids.sleeper_id.notna() & (ids.sleeper_id != "NA")].drop_duplicates("sleeper_id")
nv = pd.read_parquet(os.path.join(RAW, "nflverse", "players.parquet"))
dp = pd.read_parquet(os.path.join(BRETT_RAW, "draft_picks.parquet"))
cb = pd.read_parquet(os.path.join(BRETT_RAW, "combine.parquet"))

def clean(x):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) or str(x).strip() in ("", "NA", "None", "nan") else str(x).strip()

recs = []
for pid in sorted(spots.sleeper_id.unique()):
    p = S.get(pid, {})
    idr = ids[ids.sleeper_id == pid]
    idr = idr.iloc[0] if len(idr) else None
    gsis = clean(p.get("gsis_id")) or (clean(idr["gsis_id"]) if idr is not None else None)
    recs.append(dict(sleeper_id=pid, name=p.get("full_name") or f"{p.get('first_name','')} {p.get('last_name','')}".strip(),
                     pos=p.get("position"), nfl_team=p.get("team") or "FA", sl_birth=p.get("birth_date"), sl_years_exp=p.get("years_exp"),
                     sl_college=p.get("college"), height_in=pd.to_numeric(p.get("height"), errors="coerce"), weight_lb=pd.to_numeric(p.get("weight"), errors="coerce"),
                     depth_pos=p.get("depth_chart_position"), depth_order=p.get("depth_chart_order"), injury_status=p.get("injury_status"),
                     sl_status=p.get("status"), search_rank=p.get("search_rank"), sl_rookie_year=(p.get("metadata") or {}).get("rookie_year"),
                     gsis_id=gsis, pfr_id=clean(idr["pfr_id"]) if idr is not None else None,
                     fp_id=clean(idr["fantasypros_id"]) if idr is not None else None, ktc_id=clean(idr["ktc_id"]) if idr is not None else None,
                     dpi_draft_year=clean(idr["draft_year"]) if idr is not None else None, dpi_draft_round=clean(idr["draft_round"]) if idr is not None else None,
                     dpi_draft_ovr=clean(idr["draft_ovr"]) if idr is not None else None, dpi_college=clean(idr["college"]) if idr is not None else None))
P = pd.DataFrame(recs)

# nflverse players (by gsis) — bio, college, draft
nvk = nv.drop_duplicates("gsis_id").set_index("gsis_id")
for col in ["birth_date", "college_name", "college_conference", "rookie_season", "draft_year", "draft_round", "draft_pick", "draft_team", "years_of_experience", "pfr_id"]:
    P["nv_" + col] = P.gsis_id.map(nvk[col]) if col in nvk else None
P["pfr_id"] = P.pfr_id.fillna(P.nv_pfr_id)

# draft_picks (PFR) by gsis, then pfr id
dpg = dp[dp.gsis_id.notna()].drop_duplicates("gsis_id").set_index("gsis_id")
dpp = dp[dp.pfr_player_id.notna()].drop_duplicates("pfr_player_id").set_index("pfr_player_id")
P["dp_season"] = P.gsis_id.map(dpg.season).fillna(P.pfr_id.map(dpp.season))
P["dp_round"] = P.gsis_id.map(dpg["round"]).fillna(P.pfr_id.map(dpp["round"]))
P["dp_pick"] = P.gsis_id.map(dpg.pick).fillna(P.pfr_id.map(dpp.pick))
P["dp_college"] = P.gsis_id.map(dpg.college).fillna(P.pfr_id.map(dpp.college))

# consolidated bio / draft
P["birth_date"] = pd.to_datetime(P.nv_birth_date.fillna(P.sl_birth), errors="coerce")
P["age"] = ((TODAY - P.birth_date).dt.days / 365.25).round(2)
num = lambda s: pd.to_numeric(s, errors="coerce")
P["draft_year"] = num(P.nv_draft_year).fillna(num(P.dp_season)).fillna(num(P.dpi_draft_year))
P["draft_round"] = num(P.nv_draft_round).fillna(num(P.dp_round)).fillna(num(P.dpi_draft_round))
P["draft_pick"] = num(P.nv_draft_pick).fillna(num(P.dp_pick)).fillna(num(P.dpi_draft_ovr))
P["rookie_season"] = num(P.nv_rookie_season).where(lambda x: x > 1990).fillna(num(P.sl_rookie_year).where(lambda x: x > 1990)).fillna(P.draft_year)
P.loc[P.rookie_season.isna() & P.sl_years_exp.notna(), "rookie_season"] = 2026 - num(P.sl_years_exp)
# name fallback for draft info missing from the ID joins (e.g. late-mapped 2026 picks)
norm = lambda x: re.sub(r"[^a-z]", "", str(x).lower().replace(" jr.", "").replace(" iii", "").replace(" ii", ""))
dpn = dp.assign(k=dp.pfr_player_name.map(norm))
for i in P.index[P.draft_round.isna()]:
    ry = P.at[i, "rookie_season"]
    m = dpn[(dpn.k == norm(P.at[i, "name"])) & (dpn.season.between((ry or 2026) - 1, (ry or 2026)))]
    if len(m) == 1:
        P.loc[i, ["draft_year", "draft_round", "draft_pick"]] = [m.season.iloc[0], m["round"].iloc[0], m.pick.iloc[0]]
        P.at[i, "rookie_season"] = m.season.iloc[0]
        print("   draft info by name match:", P.at[i, "name"], m.season.iloc[0], m["round"].iloc[0], m.pick.iloc[0])
P["drafted"] = P.draft_round.notna()
P["nfl_season_num"] = 2026 - P.rookie_season + 1          # 1 = rookie in 2026
P["rookie_age"] = ((pd.to_datetime(P.rookie_season.astype("Int64").astype(str) + "-09-01", errors="coerce") - P.birth_date).dt.days / 365.25).round(2)
P["college"] = P.nv_college_name.fillna(P.dp_college).fillna(P.sl_college).fillna(P.dpi_college)
P["college_final"] = P.college.map(lambda c: c.split(";")[0].strip() if isinstance(c, str) else None)
P["final_college_season"] = (P.draft_year.fillna(P.rookie_season) - 1)

# combine (by pfr id)
cbk = cb[cb.pfr_id.notna()].drop_duplicates("pfr_id").set_index("pfr_id")
for c in ["forty", "vertical", "broad_jump", "cone", "shuttle", "bench"]:
    P[c] = P.pfr_id.map(cbk[c])

P.to_parquet(os.path.join(OUT, "players_stage1.parquet"))
mine = set(spots[spots.is_me].sleeper_id)
M = P[P.sleeper_id.isin(mine)]
print("coverage (all players / mine):")
for c in ["gsis_id", "birth_date", "rookie_season", "draft_round", "college_final", "pfr_id", "fp_id", "forty"]:
    print(f"   {c:15s} {P[c].notna().mean():.1%} / {M[c].notna().mean():.1%}")
print("positions (all):", P.pos.value_counts().to_dict())
print("mine missing gsis:", M[M.gsis_id.isna()][["name", "pos", "nfl_team"]].values.tolist())
print("mine undrafted per data:", M[~M.drafted][["name", "rookie_season", "college_final"]].values.tolist())
