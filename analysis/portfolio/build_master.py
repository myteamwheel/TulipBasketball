"""Step 2: enrich every rostered player -> out/players_all.parquet; Brett's players -> out/master_players.csv"""
import json, os, glob, re, sqlite3
import numpy as np, pandas as pd
from common import *
from colleges import classify

P = pd.read_parquet(os.path.join(OUT, "players_stage1.parquet"))
spots = pd.read_parquet(os.path.join(OUT, "roster_spots.parquet"))
NV = os.path.join(RAW, "nflverse")

# ---------------- college ----------------
C = P.apply(lambda r: pd.Series(classify(r.college_final, r.final_college_season)), axis=1)
P = pd.concat([P, C.rename(columns={"school": "school", "conf": "conf", "level": "college_level", "tier": "conf_tier"})], axis=1)

# ---------------- draft capital ----------------
def capital(r):
    if not r.drafted: return "UDFA"
    if r.draft_round == 1: return "R1 top-10" if r.draft_pick <= 10 else "R1 11-32"
    return f"R{int(r.draft_round)}"
P["capital"] = P.apply(capital, axis=1)
P["day"] = np.select([~P.drafted, P.draft_round == 1, P.draft_round <= 3], ["UDFA", "Day 1", "Day 2"], "Day 3")
P["exp_group"] = np.select([P.nfl_season_num <= 1, P.nfl_season_num == 2, P.nfl_season_num == 3], ["Rookie", "2nd year", "3rd year"], "Veteran (4+)")

# ---------------- athletic profile (combine) ----------------
P["speed_score"] = np.where(P.forty > 0, P.weight_lb * 200 / P.forty ** 4, np.nan)
ref_h = P.pos.map({"WR": 73.0, "TE": 76.4})
P["hass"] = np.where(ref_h.notna(), P.speed_score * (P.height_in / ref_h) ** 1.5, np.nan)   # height-adjusted speed score

# ---------------- college production (BRETT cfbfastR features, WR/TE/RB) ----------------
cf = pd.read_csv(os.path.join(os.path.dirname(__file__), "..", "reference", "college_features.csv"), dtype={"gsis_id": str}).drop_duplicates("gsis_id").set_index("gsis_id")
for c in ["cfb_dominator", "cfb_best_dominator", "cfb_breakout_age", "cfb_final_age", "cfb_rec_yards", "cfb_rush_yards", "cfb_seasons"]:
    P[c] = P.gsis_id.map(cf[c])

# ---------------- fantasy production (nflverse regular season) ----------------
st = pd.concat([pd.read_parquet(f, columns=["player_id", "position", "season", "recent_team", "games", "fantasy_points", "fantasy_points_ppr", "receptions"])
                for f in sorted(glob.glob(os.path.join(BRETT_RAW, "stats_player_reg_*.parquet")))], ignore_index=True)
st = st[st.position.isin(["QB", "RB", "WR", "TE"])].copy()
st["rank"] = st.groupby(["season", "position"]).fantasy_points_ppr.rank(ascending=False, method="min")
st["ppg"] = st.fantasy_points_ppr / st.games.replace(0, np.nan)
st["ppg_rank"] = st[st.games >= 7].groupby(["season", "position"]).ppg.rank(ascending=False, method="min")
STARTER, ELITE = {"QB": 12, "RB": 24, "WR": 24, "TE": 12}, {"QB": 6, "RB": 12, "WR": 12, "TE": 6}
st["starter_finish"] = st["rank"] <= st.position.map(STARTER)
st["elite_finish"] = st["rank"] <= st.position.map(ELITE)
g = st.groupby("player_id")
car = pd.DataFrame({"career_seasons": g.season.nunique(), "career_games": g.games.sum(), "career_ppr": g.fantasy_points_ppr.sum().round(1),
                    "starter_finishes": g.starter_finish.sum(), "elite_finishes": g.elite_finish.sum(), "best_rank": g["rank"].min(),
                    "first_starter_season": st[st.starter_finish].groupby("player_id").season.min(),
                    "last_starter_season": st[st.starter_finish].groupby("player_id").season.max(),
                    "prior_best_ppg": st[(st.season < 2025) & (st.games >= 7)].groupby("player_id").ppg.max(),
                    "prior3_best_ppg": st[st.season.between(2022, 2024) & (st.games >= 7)].groupby("player_id").ppg.max(),
                    "seasons_before_2025": st[st.season < 2025].groupby("player_id").season.nunique()})
s25 = st[st.season == 2025].set_index("player_id")
for c, src in [("ppr_2025", "fantasy_points_ppr"), ("half_2025", None), ("games_2025", "games"), ("ppg_2025", "ppg"),
               ("rank_2025", "rank"), ("ppg_rank_2025", "ppg_rank"), ("starter_2025", "starter_finish"), ("elite_2025", "elite_finish"), ("team_2025", "recent_team")]:
    P[c] = P.gsis_id.map(s25[src]) if src else P.gsis_id.map(s25.fantasy_points + 0.5 * s25.receptions)
for c in car.columns: P[c] = P.gsis_id.map(car[c])
for c in ["career_seasons", "career_games", "career_ppr", "starter_finishes", "elite_finishes", "seasons_before_2025"]:
    P[c] = P[c].fillna(0)

# 2025 availability: weeks on reserve lists (RES) or listed Out
rw25 = pd.read_parquet(os.path.join(NV, "roster_weekly_2025.parquet"))
res25 = rw25[rw25.status == "RES"].groupby("gsis_id").week.nunique()
inj25 = pd.read_parquet(os.path.join(BRETT_RAW, "injuries_2025.parquet"))
out25 = inj25[inj25.report_status == "Out"].groupby("gsis_id").week.nunique()
P["missed_wks_injury_2025"] = P.gsis_id.map(res25).fillna(0) + P.gsis_id.map(out25).fillna(0)

def season_2025(r):
    if r.rookie_season >= 2026: return "2026 rookie (no NFL season yet)"
    if pd.isna(r.games_2025) or r.games_2025 == 0:
        return "Missed 2025 (injury)" if r.missed_wks_injury_2025 >= 4 else "Did not play in 2025"
    if r.rookie_season == 2025: return "Rookie season"
    if r.games_2025 <= 9 and r.missed_wks_injury_2025 >= 4: return "Injury-shortened"
    if r.starter_2025 and (pd.isna(r.first_starter_season) or r.first_starter_season == 2025): return "Breakout"
    if r.games_2025 >= 7 and r.seasons_before_2025 >= 2 and r.ppg_2025 >= 6 and pd.notna(r.prior_best_ppg) and r.ppg_2025 > r.prior_best_ppg: return "Career year"
    if r.games_2025 < 7: return "Part-time / limited"
    if pd.notna(r.prior3_best_ppg) and r.prior3_best_ppg >= 8 and r.ppg_2025 <= 0.75 * r.prior3_best_ppg: return "Down year"
    return "Steady"
P["season_2025"] = P.apply(season_2025, axis=1)

# ---------------- 2026 so far (weeks 1-2) ----------------
w26 = pd.read_parquet(os.path.join(NV, "stats_player_week_2026.parquet"))
w = w26.groupby("player_id").agg(ppr_2026=("fantasy_points_ppr", "sum"), games_2026=("week", "nunique"))
P["ppr_2026"] = P.gsis_id.map(w.ppr_2026); P["games_2026"] = P.gsis_id.map(w.games_2026).fillna(0)
sn = pd.read_parquet(os.path.join(NV, "snap_counts_2026.parquet"))
sn = sn[sn.offense_snaps > 0].groupby("pfr_player_id").agg(snap_pct_2026=("offense_pct", "mean"), snap_games_2026=("week", "nunique"))
P["snap_pct_2026"] = P.pfr_id.map(sn.snap_pct_2026); P["snap_games_2026"] = P.pfr_id.map(sn.snap_games_2026).fillna(0)
rw26 = pd.read_parquet(os.path.join(NV, "roster_weekly_2026.parquet"))
last = rw26.sort_values("week").drop_duplicates("gsis_id", keep="last").set_index("gsis_id")
P["nfl_status_now"] = P.gsis_id.map(last.status)                      # ACT / RES (IR,PUP) / DEV (practice squad) / INA / CUT
def role(r):
    if r.nfl_team == "FA" or r.nfl_status_now in ("CUT", "RET"): return "No NFL team"
    if r.nfl_status_now == "RES" or r.injury_status in ("IR", "PUP", "NFI", "Out", "Doubtful", "Sus"): return "Injured / reserve"
    if r.nfl_status_now == "DEV": return "Practice squad"
    if r.snap_games_2026 >= 1 and pd.notna(r.snap_pct_2026):
        if r.snap_pct_2026 >= (0.8 if r.pos == "QB" else 0.6): return "Starter (60%+ snaps)"
        if r.snap_pct_2026 >= 0.3: return "Rotational (30-60%)"
        return "Reserve (<30%)"
    return "Backup / no offensive snaps"
P["role_2026"] = P.apply(role, axis=1)

# ---------------- market values ----------------
M = os.path.join(RAW, "market")
FCN = {"Dynasty Bois": "bois", "NOWL": "nowl", "Awesome": "awesome", "Brokeback": "brokeback", "Big Show": "bigshow", "DynastyMaxxing": "maxxing"}
fc = {k: {x["player"]["sleeperId"]: x for x in json.load(open(os.path.join(M, f"fc_{k}.json"))) if x["player"].get("sleeperId")}
      for k in list(FCN.values()) + ["sf12", "1qb12"]}
for k, d in fc.items():
    P[f"fc_{k}"] = P.sleeper_id.map(lambda s: d.get(s, {}).get("value", 0)).astype(float)
P["fc_sf12_rank"] = P.sleeper_id.map(lambda s: fc["sf12"].get(s, {}).get("overallRank"))
P["fc_1qb12_rank"] = P.sleeper_id.map(lambda s: fc["1qb12"].get(s, {}).get("overallRank"))
P["fc_trend30_sf12"] = P.sleeper_id.map(lambda s: fc["sf12"].get(s, {}).get("trend30Day"))
P["fc_trend30_1qb12"] = P.sleeper_id.map(lambda s: fc["1qb12"].get(s, {}).get("trend30Day"))
# portfolio-format value: mean of the six league-format values; ranked within the whole FantasyCalc universe
uni = set().union(*[set(fc[k]) for k in FCN.values()])
pv = pd.Series({s: np.mean([fc[k].get(s, {}).get("value", 0) for k in FCN.values()]) for s in uni})
P["fc_portfolio"] = P.sleeper_id.map(pv).fillna(0)
P["fc_portfolio_rank"] = P.sleeper_id.map(pv.rank(ascending=False, method="min"))

dpv = pd.read_csv(os.path.join(M, "values-players.csv"), dtype={"fp_id": str})
dpv = dpv.drop_duplicates("fp_id").set_index("fp_id")
for c in ["value_1qb", "value_2qb", "ecr_1qb", "ecr_2qb"]:
    P[f"dp_{c}"] = P.fp_id.map(dpv[c])
P["dp_portfolio"] = (4 * P.dp_value_2qb.fillna(0) + 2 * P.dp_value_1qb.fillna(0)) / 6    # 4 SF leagues + 2 1QB leagues
dp_uni = (4 * dpv.value_2qb.fillna(0) + 2 * dpv.value_1qb.fillna(0)) / 6
P["dp_portfolio_rank"] = P.fp_id.map(dp_uni.rank(ascending=False, method="min"))

# DP history (monthly, fp_id keyed from 2020-05)
hist = []
for f in sorted(glob.glob(os.path.join(M, "dp_history", "dp_*.csv"))):
    d = pd.read_csv(f, encoding="utf-8-sig", dtype={"fp_id": str})
    if "fp_id" not in d or "value_2qb" not in d: continue
    d["date"] = pd.Timestamp(os.path.basename(f)[3:13])
    hist.append(d[["date", "fp_id", "value_1qb", "value_2qb", "ecr_1qb", "ecr_2qb"]])
H = pd.concat(hist, ignore_index=True).dropna(subset=["fp_id"])
H["pv"] = (4 * H.value_2qb.fillna(0) + 2 * H.value_1qb.fillna(0)) / 6
H.to_parquet(os.path.join(OUT, "dp_value_history.parquet"))
def at(date):
    snap = H[H.date == H.date[H.date <= pd.Timestamp(date)].max()]
    return snap.drop_duplicates("fp_id").set_index("fp_id").pv
P["dp_pv_postdraft"] = P.fp_id.map(at("2026-05-31"))
P["dp_pv_1y"] = P.fp_id.map(at("2025-09-30"))
P["dp_pv_peak"] = P.fp_id.map(H.groupby("fp_id").pv.max())
P["dp_pv_peak_date"] = P.fp_id.map(H.loc[H.groupby("fp_id").pv.idxmax()].set_index("fp_id").date)
P["dp_chg_since_draft"] = (P.dp_portfolio - P.dp_pv_postdraft) / P.dp_pv_postdraft.replace(0, np.nan)
P["dp_chg_1y"] = (P.dp_portfolio - P.dp_pv_1y) / P.dp_pv_1y.replace(0, np.nan)
P["dp_pct_of_peak"] = P.dp_portfolio / P.dp_pv_peak.replace(0, np.nan)
fc_tr = (P.fc_trend30_sf12 / P.fc_sf12.replace(0, np.nan))
def trend(r, ft):
    ch = r.dp_chg_since_draft
    if pd.isna(ch) or (r.dp_portfolio < 150 and r.dp_pv_postdraft < 150):
        return "Unvalued" if pd.isna(ft) else ("Rising" if ft >= 0.10 else "Falling" if ft <= -0.10 else "Stable")
    return "Rising" if ch >= 0.15 else "Falling" if ch <= -0.15 else "Stable"
P["value_trend"] = [trend(r, ft) for r, ft in zip(P.itertuples(), fc_tr)]
P["fc_trend30_pct"] = fc_tr

# value tier on the FantasyCalc portfolio-format rank (DP rank kept as the cross-check)
def tier(rank, r):
    if pd.notna(rank) and rank <= 36: return "1 Elite"
    if pd.notna(rank) and rank <= 100: return "2 High-value starter"
    if pd.notna(rank) and rank <= 200: return "3 Mid-tier"
    return "4 Upside/developmental" if (r.age <= 24.5 or r.nfl_season_num <= 2) else "5 Low-value depth"
P["value_tier"] = [tier(rk, r) for rk, r in zip(P.fc_portfolio_rank, P.itertuples())]
P["value_tier_dp"] = [tier(rk, r) for rk, r in zip(P.dp_portfolio_rank, P.itertuples())]

# ---------------- prospect archetype (mutually exclusive, in this precedence) ----------------
def archetype(r):
    early_producer = r.starter_finishes > 0
    late = pd.notna(r.first_starter_season) and (r.first_starter_season - r.rookie_season + 1) >= 3
    top_capital = r.drafted and r.draft_pick <= 64
    if not r.drafted: return "Undrafted breakout" if early_producer else "Undrafted developmental"
    if top_capital and r.nfl_season_num >= 3 and r.starter_finishes <= 1 and pd.notna(r.dp_pct_of_peak) and r.dp_pct_of_peak <= 0.5: return "Former top prospect, value declined"
    if late: return "Late-blooming producer"
    if r.draft_round == 1: return "First-round pedigree"
    if r.draft_round <= 3: return "Day 2 prospect"
    return "Day 3 producer" if early_producer else "Day 3 developmental"
P["archetype"] = P.apply(archetype, axis=1)
P["established_starter"] = P.starter_2025.astype("boolean").fillna(False).astype(bool) | (P.last_starter_season >= 2023) & (P.starter_finishes >= 2)

P.to_parquet(os.path.join(OUT, "players_all.parquet"))
print("players_all:", P.shape)
print(P.season_2025.value_counts().to_dict()); print(P.role_2026.value_counts().to_dict()); print(P.value_tier.value_counts().sort_index().to_dict())
print(P.archetype.value_counts().to_dict()); print(P.value_trend.value_counts().to_dict())
mine = set(spots[spots.is_me].sleeper_id); Mn = P[P.sleeper_id.isin(mine)]
for c in ["ppr_2025", "fc_portfolio", "dp_portfolio", "dp_pv_peak", "snap_pct_2026", "cfb_dominator", "forty", "nfl_status_now"]:
    print(f"   coverage {c:15s} all {P[c].notna().mean():.0%}  mine {Mn[c].notna().mean():.0%}")
