"""Combine / athletic-testing tendencies: Brett's players vs league-mates (current rosters, all acquisitions, trades),
by position, league and team, with within-league/position permutation tests and a controlled regression."""
import json, os, re
import numpy as np, pandas as pd
import statsmodels.api as sm, statsmodels.formula.api as smf
from common import *
from load import load

rng = np.random.default_rng(40)
PH = pd.read_parquet(os.path.join(OUT, "players_hist.parquet"))
cb = pd.read_parquet(os.path.join(BRETT_RAW, "combine.parquet"))
db = pd.read_csv(os.path.join(RAW, "market", "db_playerids.csv"), dtype=str).drop_duplicates("sleeper_id").set_index("sleeper_id")
nv = pd.read_parquet(os.path.join(RAW, "nflverse", "players.parquet")).drop_duplicates("gsis_id").set_index("gsis_id")
FPOS = ["QB", "RB", "WR", "TE"]
def inches(h):
    m = re.match(r"(\d)-(\d+)", str(h)); return int(m.group(1)) * 12 + int(m.group(2)) if m else np.nan
cb["ht_in"] = cb.ht.map(inches); cb["wt"] = pd.to_numeric(cb.wt, errors="coerce")
ref = cb[cb.pos.isin(FPOS)].copy()

# ---- link every historical player to a combine row
norm = lambda x: re.sub(r"[^a-z]", "", str(x).lower().replace(" jr.", "").replace(" iii", "").replace(" ii", "").replace(" sr.", ""))
cb["k"] = cb.player_name.map(norm)
cb_pfr = cb[cb.pfr_id.notna()].drop_duplicates("pfr_id").set_index("pfr_id")
pfr = PH.player_id.map(db.pfr_id).where(lambda s: s.notna() & (s != "NA"))
pfr = pfr.fillna(PH.gsis_id.map(nv.pfr_id))
rows, how = [], []
for i, r in PH.iterrows():
    p = pfr.get(i)
    if isinstance(p, str) and p in cb_pfr.index:
        rows.append(cb_pfr.loc[p]); how.append("pfr"); continue
    yr = r.draft_year if pd.notna(r.draft_year) else r.rookie_season
    m = cb[(cb.k == norm(r["name"])) & (cb.season.between((yr or 0) - 1, (yr or 0)))]
    if len(m) == 1: rows.append(m.iloc[0]); how.append("name")
    else: rows.append(None); how.append(None)
M = pd.DataFrame([dict(player_id=PH.at[i, "player_id"], **({k: r[k] for k in ["pos", "season", "forty", "vertical", "broad_jump", "bench", "cone", "shuttle", "ht_in", "wt"]} if r is not None else {}))
                  for i, r in zip(PH.index, rows)])
M = M.rename(columns={"pos": "combine_pos", "season": "combine_year"})
M["linked"] = [h is not None for h in how]
M["fpos"] = PH.pos.values
# ---- percentiles vs every combine participant at the same position (2000-2026)
METRICS = {"forty": -1, "vertical": 1, "broad_jump": 1, "cone": -1, "shuttle": -1, "bench": 1, "ht_in": 1, "wt": 1}
def pct(values, refvals, sign):
    refvals = np.sort(refvals[~np.isnan(refvals)])
    if len(refvals) == 0: return np.full(len(values), np.nan)
    lo = np.searchsorted(refvals, values, side="left"); hi = np.searchsorted(refvals, values, side="right")
    p = (lo + hi) / 2 / len(refvals)
    p = np.where(np.isnan(values), np.nan, p)
    return p if sign > 0 else 1 - p
for m, sgn in METRICS.items():
    M[m + "_pct"] = np.nan
    for pos in FPOS:
        idx = M.fpos == pos
        M.loc[idx, m + "_pct"] = pct(M.loc[idx, m].astype(float).values, ref[ref.pos == pos][m].astype(float).values, sgn)
M["speed_score"] = M.wt * 200 / M.forty ** 4
refss = ref.assign(ss=ref.wt * 200 / ref.forty ** 4)
M["speed_score_pct"] = np.nan
for pos in FPOS:
    idx = M.fpos == pos
    M.loc[idx, "speed_score_pct"] = pct(M.loc[idx, "speed_score"].astype(float).values, refss[refss.pos == pos].ss.astype(float).values, 1)
drills = ["forty_pct", "vertical_pct", "broad_jump_pct", "cone_pct", "shuttle_pct"]
M["n_drills"] = M[drills].notna().sum(axis=1)
M["athletic"] = np.where(M.n_drills >= 3, M[drills].mean(axis=1), np.nan)
M["explosion"] = M[["vertical_pct", "broad_jump_pct"]].mean(axis=1)
M["agility"] = M[["cone_pct", "shuttle_pct"]].mean(axis=1)
M["size"] = M[["ht_in_pct", "wt_pct"]].mean(axis=1)
M["tested_any"] = M.n_drills >= 1
M["ran_forty"] = M.forty.notna()
M.to_parquet(os.path.join(OUT, "athletic.parquet"))
print("linked to combine:", f"{M.linked.mean():.1%}", "| by pfr", how.count("pfr"), "| by name", how.count("name"), "| athletic score available:", f"{M.athletic.notna().mean():.1%}")

COLS = ["athletic", "forty_pct", "vertical_pct", "broad_jump_pct", "cone_pct", "shuttle_pct", "bench_pct", "explosion", "agility", "size", "ht_in_pct", "wt_pct", "speed_score_pct", "tested_any", "ran_forty"]
LAB = {"athletic": "Athletic score (composite)", "forty_pct": "40-yard dash", "vertical_pct": "Vertical jump", "broad_jump_pct": "Broad jump", "cone_pct": "3-cone", "shuttle_pct": "Short shuttle",
       "bench_pct": "Bench press", "explosion": "Explosion (vertical + broad)", "agility": "Agility (cone + shuttle)", "size": "Size (height + weight)", "ht_in_pct": "Height", "wt_pct": "Weight",
       "speed_score_pct": "Speed score (weight-adjusted 40)", "tested_any": "Tested at the combine", "ran_forty": "Ran the 40 at the combine"}
Mi = M.set_index("player_id")

def strat_compare(df, col, strata=("league", "pos"), n_perm=4000):
    """Brett minus league-mates within strata, weighted by Brett's count; permutation p (labels shuffled within strata)."""
    d = df[df[col].notna()][[*strata, "me", col]].copy()
    d[col] = d[col].astype(float)
    groups = [(g[col].values, g.me.values) for _, g in d.groupby(list(strata)) if g.me.any() and (~g.me).any()]
    if not groups: return None
    def stat(gs):
        num = den = 0.0
        for v, m in gs:
            k = m.sum(); num += k * (v[m].mean() - v[~m].mean()); den += k
        return num / den
    obs = stat(groups)
    perms = []
    for _ in range(n_perm):
        gs = [(v, rng.permutation(m)) for v, m in groups]
        perms.append(stat(gs))
    perms = np.array(perms)
    me_vals = d[d.me][col]; lm_vals = d[~d.me][col]
    return dict(diff=float(obs), p=float((np.abs(perms) >= abs(obs)).mean()), n_me=int(d.me.sum()), n_lm=int((~d.me).sum()),
                me_mean=float(me_vals.mean()), lm_mean=float(lm_vals.mean()))

R = {}
# ---------------- A. current roster spots ----------------
S, P = load()
S = S[S.pos.isin(FPOS)].copy()
S = S.join(Mi[COLS], on="sleeper_id")
S["me"] = S.is_me
R["current_overall"] = {c: strat_compare(S, c) for c in COLS}
R["current_by_pos"] = {pos: {c: strat_compare(S[S.pos == pos], c) for c in ["athletic", "forty_pct", "vertical_pct", "broad_jump_pct", "cone_pct", "shuttle_pct", "size", "speed_score_pct", "tested_any"]} for pos in FPOS}
R["current_by_league"] = {}
for l, _, _ in LEAGUES:
    R["current_by_league"][l] = {c: strat_compare(S[S.league == l], c, strata=("pos",), n_perm=2000) for c in ["athletic", "forty_pct", "explosion", "agility", "size", "tested_any"]}
# team rankings per league (every roster, current): position-adjusted = mean of player percentiles
teams = []
for (l, rid), g in S.groupby(["league", "roster_id"]):
    teams.append(dict(league=l, roster_id=int(rid), team=g.team.iloc[0], me=bool(g.me.iloc[0]), n=len(g), tested=float(g.tested_any.mean()),
                      athletic=float(g.athletic.mean()), forty=float(g.forty_pct.mean()), explosion=float(g.explosion.mean()), agility=float(g.agility.mean()), size=float(g["size"].mean())))
TM = pd.DataFrame(teams)
for c in ["athletic", "forty", "explosion", "agility", "size"]:
    TM[c + "_rank"] = TM.groupby("league")[c].rank(ascending=False, method="min")
TM["n_teams"] = TM.league.map(TM.groupby("league").size())
R["teams"] = TM.round(4).to_dict("records")
# vs everything: Brett's unique players vs the combine population (50 = average participant) and vs all rostered players
U = S[S.me].drop_duplicates("sleeper_id")
R["vs_population"] = {c: dict(brett=float(U[c].astype(float).mean()), rostered_all=float(S.drop_duplicates("sleeper_id")[c].astype(float).mean()), n=int(U[c].notna().sum()))
                      for c in ["athletic", "forty_pct", "vertical_pct", "broad_jump_pct", "cone_pct", "shuttle_pct", "bench_pct", "size", "speed_score_pct"]}
R["vs_population_by_pos"] = {pos: {c: dict(brett=float(U[U.pos == pos][c].astype(float).mean()), rostered_all=float(S[S.pos == pos].drop_duplicates("sleeper_id")[c].astype(float).mean()),
                                            n=int(U[U.pos == pos][c].notna().sum())) for c in ["athletic", "forty_pct", "explosion", "agility", "size", "speed_score_pct"]} for pos in FPOS}
# controlled model: does athleticism predict Brett's ownership beyond age, value, draft slot, position and league?
D = S.dropna(subset=["age"]).copy()
D["y"] = D.me.astype(int); D["age_z"] = (D.age - D.age.mean()) / D.age.std()
D["logv"] = np.log1p(D.fc_portfolio); D["logv_z"] = (D.logv - D.logv.mean()) / D.logv.std()
D["logpick"] = np.log(D.draft_pick.fillna(263)); D["logpick_z"] = (D.logpick - D.logpick.mean()) / D.logpick.std()
models = {}
for c in ["athletic", "forty_pct", "vertical_pct", "broad_jump_pct", "cone_pct", "shuttle_pct", "size", "speed_score_pct"]:
    d = D[D[c].notna()].copy(); d["x"] = (d[c] - d[c].mean()) / d[c].std()
    out = {}
    for name, f in [("raw", "y ~ C(league) + C(pos) + x"), ("controlled", "y ~ C(league) + C(pos) + x + age_z + logv_z + logpick_z")]:
        m = smf.glm(f, data=d, family=sm.families.Binomial()).fit(cov_type="cluster", cov_kwds={"groups": d.sleeper_id.astype("category").cat.codes})
        out[name] = dict(or_=float(np.exp(m.params["x"])), lo=float(np.exp(m.conf_int().loc["x", 0])), hi=float(np.exp(m.conf_int().loc["x", 1])), p=float(m.pvalues["x"]), n=int(len(d)), events=int(d.y.sum()))
    models[c] = out
R["models"] = models
# the fastest / most athletic / least athletic of Brett's current players
cols_show = ["name", "pos", "nfl_team", "forty", "vertical", "broad_jump", "cone", "shuttle", "athletic", "forty_pct"]
Ux = U.join(M.set_index("player_id")[["forty", "vertical", "broad_jump", "cone", "shuttle"]], on="sleeper_id", rsuffix="_raw")
for c in ["forty", "vertical", "broad_jump", "cone", "shuttle"]: Ux[c] = Ux[c + "_raw"] if c + "_raw" in Ux else Ux[c]
R["top_athletes"] = Ux.sort_values("athletic", ascending=False).head(12)[cols_show].round(3).to_dict("records")
R["low_athletes"] = Ux[Ux.athletic.notna()].sort_values("athletic").head(10)[cols_show].round(3).to_dict("records")
R["untested"] = Ux[~Ux.tested_any.astype(bool)][["name", "pos", "school", "capital"]].to_dict("records")
R["multi_vs_single"] = {}
mu = S[S.me].groupby("sleeper_id").size()
U2 = U.assign(multi=U.sleeper_id.map(mu) >= 2)
for c in ["athletic", "forty_pct", "explosion", "agility", "size"]:
    a, b = U2[U2.multi][c].astype(float).dropna(), U2[~U2.multi][c].astype(float).dropna()
    from scipy.stats import mannwhitneyu
    R["multi_vs_single"][c] = dict(multi=float(a.mean()), single=float(b.mean()), n_multi=len(a), n_single=len(b), p=float(mannwhitneyu(a, b).pvalue) if len(a) > 2 else None)

# ---------------- B. every acquisition in Brett's league-seasons ----------------
ST = pd.read_parquet(os.path.join(OUT, "stints_enriched.parquet"))
H = os.path.join(RAW, "sleeper", "history"); chains = json.load(open(os.path.join(H, "_chains.json")))
mine_ls = set()
for label, chain in chains.items():
    for season, lid in chain:
        if ME in {r.get("owner_id") for r in json.load(open(os.path.join(H, lid, "rosters.json")))}: mine_ls.add((label, int(season)))
A = ST[[(l, int(s)) in mine_ls for l, s in zip(ST.league, ST.start_season)]].copy()
A = A[~A.start_method.isin(["Inherited (took over team)", "Unrecorded add"]) & ~((A.days * 24 < 1) & (A.end_method != "Still rostered"))]
A = A[A.pos.isin(FPOS)].join(Mi[COLS], on="player_id")
A["me"] = A.owner == ME
R["acq_overall"] = {c: strat_compare(A, c) for c in COLS}
R["acq_by_method"] = {m: {c: strat_compare(A[A.start_method == m], c, n_perm=2000) for c in ["athletic", "forty_pct", "explosion", "size", "tested_any"]} for m in ["Rookie draft", "Startup draft", "Trade", "Waiver claim", "Free-agent add"]}
R["acq_by_pos"] = {pos: {c: strat_compare(A[A.pos == pos], c, n_perm=2000) for c in ["athletic", "forty_pct", "explosion", "agility", "size"]} for pos in FPOS}
# managers ranked by the athleticism of everything they've acquired (same league-seasons)
mg = A.groupby(["league", "owner"]).agg(n=("player_id", "size"), athletic=("athletic", "mean"), forty=("forty_pct", "mean"), tested=("tested_any", "mean")).reset_index()
mg = mg[mg.n >= 15]; mg["me"] = mg.owner == ME
mg["rank"] = mg.groupby("league").athletic.rank(ascending=False, method="min"); mg["of"] = mg.league.map(mg.groupby("league").size())
R["acq_mgr_rank"] = mg[mg.me].round(4).to_dict("records")
# athleticism and how long Brett keeps players
A["ath_band"] = pd.cut(A.athletic, [0, 0.33, 0.67, 1.01], labels=["Bottom third", "Middle third", "Top third"])
R["tenure_by_ath"] = A.groupby(["ath_band", "me"]).days.median().round(1).unstack().rename(columns={True: "brett", False: "lm"}).reset_index().astype({"ath_band": str}).to_dict("records")

# ---------------- C. trades: athleticism in vs out ----------------
TS = pd.read_parquet(os.path.join(OUT, "trade_sides.parquet"))
TS = TS[[(l, int(s)) in mine_ls for l, s in zip(TS.league, TS.season)]]
tr = []
for r in TS.itertuples():
    for side, lst in (("in", json.loads(r.players_in)), ("out", json.loads(r.players_out))):
        for p in lst:
            if PH.set_index("player_id").pos.get(p) in FPOS:
                tr.append(dict(league=r.league, me=r.manager == ME, side=side, player_id=p, pos=PH.set_index("player_id").pos.get(p)))
TR = pd.DataFrame(tr).join(Mi[COLS], on="player_id")
R["trade_in_out"] = {}
for c in ["athletic", "forty_pct", "explosion", "agility", "size", "tested_any"]:
    b_in, b_out = TR[TR.me & (TR.side == "in")][c].astype(float), TR[TR.me & (TR.side == "out")][c].astype(float)
    l_in, l_out = TR[~TR.me & (TR.side == "in")][c].astype(float), TR[~TR.me & (TR.side == "out")][c].astype(float)
    R["trade_in_out"][c] = dict(brett_in=float(b_in.mean()), brett_out=float(b_out.mean()), lm_in=float(l_in.mean()), lm_out=float(l_out.mean()),
                                n_in=int(b_in.notna().sum()), n_out=int(b_out.notna().sum()))
R["trade_in_strat"] = {c: strat_compare(TR[TR.side == "in"], c, n_perm=2000) for c in ["athletic", "forty_pct", "explosion", "agility", "size"]}
R["coverage"] = dict(linked=float(M.linked.mean()), athletic_available=float(M.athletic.notna().mean()))
json.dump(R, open(os.path.join(OUT, "analysis_combine.json"), "w"), default=lambda o: None if (isinstance(o, float) and np.isnan(o)) else (o.item() if hasattr(o, "item") else str(o)))
pd.set_option("display.width", 220)
show = lambda d: pd.DataFrame({k: v for k, v in d.items() if v}).T.round(3)
print("\n== CURRENT ROSTERS (within league x position; diff in percentile points)\n", show(R["current_overall"]).to_string())
print("\n== ALL ACQUISITIONS\n", show(R["acq_overall"]).to_string())
for pos in FPOS: print(f"\n-- current {pos}\n", show(R["current_by_pos"][pos]).to_string())
print("\n== MODELS (odds ratio per SD)"); print(pd.DataFrame({k: {**{f"raw_{a}": v['raw'][a] for a in ['or_', 'p']}, **{f"ctl_{a}": v['controlled'][a] for a in ['or_', 'lo', 'hi', 'p']}} for k, v in R["models"].items()}).T.round(3).to_string())
print("\n== BY LEAGUE (athletic diff, p)"); print({l: (round(v["athletic"]["diff"], 3), round(v["athletic"]["p"], 3), round(v["forty_pct"]["diff"], 3), round(v["forty_pct"]["p"], 3)) for l, v in R["current_by_league"].items()})
print("\n== MY TEAM RANKS"); print(TM[TM.me][["league", "team", "athletic", "athletic_rank", "forty_rank", "explosion_rank", "agility_rank", "size_rank", "n_teams", "tested"]].round(3).to_string())
print("\n== VS POPULATION", {k: (round(v["brett"], 3), round(v["rostered_all"], 3)) for k, v in R["vs_population"].items()})
print("\n== TRADES in/out", {k: {a: round(b, 3) for a, b in v.items()} for k, v in R["trade_in_out"].items()})
print("trade_in strat", show(R["trade_in_strat"]).to_string())
print("\n== acq by method"); [print(m, {c: (round(v['diff'], 3), round(v['p'], 3)) for c, v in d.items() if v}) for m, d in R["acq_by_method"].items()]
print("\nacq mgr rank", R["acq_mgr_rank"]); print("tenure by ath", R["tenure_by_ath"]); print("multi vs single", R["multi_vs_single"])
