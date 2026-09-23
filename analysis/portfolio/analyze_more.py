"""Robustness checks and follow-ups."""
import json, os
import numpy as np, pandas as pd
from scipy import stats
import statsmodels.api as sm, statsmodels.formula.api as smf
from common import *
from load import load
S, P = load(); mine = S[S.is_me]; LO = [l for l, _, _ in LEAGUES]
Y = {}
ids = pd.read_csv(os.path.join(RAW, "market", "db_playerids.csv"), dtype=str).drop_duplicates("sleeper_id").set_index("sleeper_id")
E = pd.read_parquet(os.path.join(OUT, "add_events.parquet"))
H = pd.read_parquet(os.path.join(OUT, "dp_value_history.parquet"))
own = E[["league", "season", "roster_owner"]].drop_duplicates()
my_seasons = own[own.roster_owner == ME][["league", "season"]].drop_duplicates()
SF = {l: f["sf"] for l, _, f in LEAGUES}

# (a) post-hype, young players only, split by method
Ev = E[E.method.isin(["Trade", "Waiver claim", "Free-agent add"])].merge(my_seasons, on=["league", "season"]).copy()
Ev["fp_id"] = Ev.player_id.map(ids.fantasypros_id); Ev["bd"] = pd.to_datetime(Ev.player_id.map(ids.birthdate), errors="coerce")
Ev["draft_ovr"] = pd.to_numeric(Ev.player_id.map(ids.draft_ovr), errors="coerce")
Ev = Ev.dropna(subset=["fp_id", "date"]); Ev["age_acq"] = (Ev.date - Ev.bd).dt.days / 365.25
Hg = {k: g.sort_values("date") for k, g in H.groupby("fp_id")}
rows = []
for r in Ev.itertuples():
    g = Hg.get(r.fp_id)
    if g is None: continue
    b = g[g.date <= r.date]
    if len(b) < 3: continue
    col = "value_2qb" if SF[r.league] else "value_1qb"
    rows.append(dict(me=r.roster_owner == ME, method=r.method, age=r.age_acq, top64=r.draft_ovr <= 64, v=b[col].iloc[-1], peak=b[col].max(), name=ids.name.get(r.player_id), league=r.league, date=r.date))
PH = pd.DataFrame(rows); PH["pct"] = PH.v / PH.peak
out = []
for lab, d in [("Trades, age ≤26 at acquisition", PH[(PH.method == "Trade") & (PH.age <= 26)]),
               ("Trades, age ≤26, top-64 NFL pick", PH[(PH.method == "Trade") & (PH.age <= 26) & PH.top64]),
               ("Waiver/FA adds, age ≤26", PH[(PH.method != "Trade") & (PH.age <= 26)]),
               ("Waiver/FA adds, age 27+", PH[(PH.method != "Trade") & (PH.age > 26)]),
               ("Trades, age 27+", PH[(PH.method == "Trade") & (PH.age > 26)])]:
    d = d[d.peak >= 1500]
    a, b = d[d.me].pct, d[~d.me].pct
    out.append(dict(subset=lab, n_brett=len(a), n_others=len(b), brett_median=a.median(), others_median=b.median(),
                    brett_le50=(a <= 0.5).mean(), others_le50=(b <= 0.5).mean(), p=stats.mannwhitneyu(a, b).pvalue if len(a) > 2 else None))
Y["posthype_young"] = out
# share of Brett's trade acquisitions that were young former top prospects at <=50% of peak
t = PH[(PH.method == "Trade") & (PH.peak >= 1500)]
Y["posthype_share"] = dict(brett=float(((t.age <= 26) & t.top64 & (t.pct <= 0.5))[t.me].mean()), others=float(((t.age <= 26) & t.top64 & (t.pct <= 0.5))[~t.me].mean()),
                           n_brett=int(t.me.sum()), n_others=int((~t.me).sum()))
Y["posthype_young_examples"] = PH[PH.me & (PH.method == "Trade") & (PH.age <= 26) & PH.top64 & (PH.pct <= 0.5) & (PH.peak >= 1500)].sort_values("date")[["name", "league", "date", "age", "v", "peak", "pct"]].round(2).astype(str).to_dict("records")

# (b) FCS effect without North Dakota State
D = S[S.pos.isin(["QB", "RB", "WR", "TE"])].dropna(subset=["age"]).copy()
D["y"] = D.is_me.astype(int); D["age_z"] = (D.age - D.age.mean()) / D.age.std(); D["logv_z"] = np.log1p(D.fc_portfolio); D["logv_z"] = (D.logv_z - D.logv_z.mean()) / D.logv_z.std()
D["fcs"] = D.conf_tier.isin(["FCS", "D-II", "D-III"]).astype(int); D["ndsu"] = (D.school == "North Dakota State").astype(int)
D["fcs_not_ndsu"] = D.fcs * (1 - D.ndsu)
m = smf.glm("y ~ C(league) + age_z + logv_z + C(pos) + ndsu + fcs_not_ndsu", data=D, family=sm.families.Binomial()).fit(cov_type="cluster", cov_kwds={"groups": D.sleeper_id.astype("category").cat.codes})
Y["fcs_split"] = {k: dict(or_=float(np.exp(m.params[k])), lo=float(np.exp(m.conf_int().loc[k, 0])), hi=float(np.exp(m.conf_int().loc[k, 1])), p=float(m.pvalues[k])) for k in ["ndsu", "fcs_not_ndsu", "age_z", "logv_z"]}
Y["fcs_counts"] = dict(brett_fcs_spots=int(mine.conf_tier.isin(["FCS", "D-II", "D-III"]).sum()), brett_ndsu_spots=int((mine.school == "North Dakota State").sum()),
                       lm_ndsu_share=float((S[~S.is_me].school == "North Dakota State").mean()), brett_ndsu_share=float((mine.school == "North Dakota State").mean()),
                       ndsu_rostered_anywhere=sorted(set(S[S.school == "North Dakota State"].name)))
# robustness: age effect without the two 32-team leagues, and without Dynasty Bois
for lab, sub in [("excl_32team", D[D.n_teams < 32]), ("excl_bois", D[D.league != "Dynasty Bois"]), ("only_32team", D[D.n_teams == 32])]:
    mm = smf.glm("y ~ C(league) + age_z + logv_z + C(pos)", data=sub, family=sm.families.Binomial()).fit(cov_type="cluster", cov_kwds={"groups": sub.sleeper_id.astype("category").cat.codes})
    Y[f"age_{lab}"] = dict(or_=float(np.exp(mm.params["age_z"])), lo=float(np.exp(mm.conf_int().loc["age_z", 0])), hi=float(np.exp(mm.conf_int().loc["age_z", 1])), p=float(mm.pvalues["age_z"]), n=int(sub.y.sum()))

# (c) value share by position (league-format FC value) vs league-mates, per league
FCK = {"Dynasty Bois": "fc_bois", "NOWL": "fc_nowl", "Awesome": "fc_awesome", "Brokeback": "fc_brokeback", "Big Show": "fc_bigshow", "DynastyMaxxing": "fc_maxxing"}
vs = []
for l in LO:
    L = S[S.league == l].copy(); L["v"] = L[FCK[l]]
    sh = L.groupby(["roster_id", "pos"]).v.sum().unstack(fill_value=0); sh = sh.div(sh.sum(axis=1), axis=0)
    myr = L[L.is_me].roster_id.iloc[0]
    for p in ["QB", "RB", "WR", "TE"]:
        vs.append(dict(league=l, pos=p, brett=float(sh.loc[myr, p]), lm=float(sh.drop(myr)[p].mean()), rank=int((sh[p] > sh.loc[myr, p]).sum() + 1), n=len(sh)))
    # QB quality: value of best QB and count of QBs
    q = L[L.pos == "QB"].groupby("roster_id").v.agg(["max", "size", "sum"])
    vs.append(dict(league=l, pos="QB1 value", brett=float(q.loc[myr, "max"]) if myr in q.index else 0, lm=float(q.drop(myr, errors="ignore")["max"].mean()),
                   rank=int((q["max"] > q.loc[myr, "max"]).sum() + 1), n=len(q)))
Y["value_by_pos"] = vs
# elite by position
el = P[P.fc_portfolio_rank <= 36]
Y["elite_by_pos"] = [dict(pos=p, universe=int((el.pos == p).sum()), owned=int(el[(el.pos == p)].sleeper_id.isin(set(mine.sleeper_id)).sum()),
                          names_owned=list(el[(el.pos == p) & el.sleeper_id.isin(set(mine.sleeper_id))].name)) for p in ["QB", "RB", "WR", "TE"]]

# (d) TE share vs TEP setting
te = []
for l, _, f in LEAGUES:
    L = S[S.league == l]
    shares = L.groupby("roster_id").apply(lambda g: (g.pos == "TE").mean())
    myr = L[L.is_me].roster_id.iloc[0]
    te.append(dict(league=l, tep=f["tep"], brett=float(shares[myr]), lm=float(shares.drop(myr).mean()), rank=int((shares > shares[myr]).sum() + 1), n=len(shares)))
Y["te_by_tep"] = te

# (e) leash test Fisher
lp = S[(S.nfl_season_num >= 3) & (S.starter_finishes == 0)]
tab = pd.crosstab(lp.is_me, lp.draft_pick <= 64)
Y["leash_fisher"] = dict(table=tab.values.tolist(), p=float(stats.fisher_exact(tab.values)[1]))
base = S[S.nfl_season_num >= 3]
tab2 = pd.crosstab(base.is_me, base.draft_pick <= 64)
Y["top64_share_yr3plus_all"] = dict(brett=float((mine[mine.nfl_season_num >= 3].draft_pick <= 64).mean()), lm=float((S[~S.is_me & (S.nfl_season_num >= 3)].draft_pick <= 64).mean()))

# (f) production buckets (unique players) with multi vs single split
U = pd.read_parquet(os.path.join(OUT, "my_unique.parquet"))
U["strong25"] = U.starter_2025.astype("boolean").fillna(False).astype(bool)
U["disappointing25"] = U.season_2025.isin(["Down year"])
U["injury25"] = U.season_2025.isin(["Injury-shortened", "Missed 2025 (injury)"])
U["injured_now"] = U.role_2026 == "Injured / reserve"
U["projection"] = (U.nfl_season_num <= 3) & (U.starter_finishes == 0)
U["backup"] = U.role_2026.isin(["Reserve (<30%)", "Backup / no offensive snaps", "Practice squad"]) & ~U.established_starter.astype(bool)
U["established"] = U.established_starter.astype(bool)
bk = []
for c, lab in [("strong25", "Coming off a strong 2025 (starter-level finish)"), ("disappointing25", "Coming off a down 2025"), ("injury25", "2025 lost/shortened by injury"),
               ("injured_now", "Injured / on reserve now"), ("projection", "Projection bet (years 1-3, no starter finish yet)"),
               ("backup", "Backup / developmental role now"), ("established", "Established fantasy starter")]:
    bk.append(dict(bucket=lab, n=int(U[c].sum()), share=float(U[c].mean()), multi=float(U[U.n_leagues >= 2][c].mean()), single=float(U[U.n_leagues == 1][c].mean())))
Y["prod_buckets"] = bk
Y["top_producers_2025"] = U.sort_values("ppr_2025", ascending=False).head(12)[["name", "pos", "ppr_2025", "rank_2025", "n_leagues"]].to_dict("records")
Y["season25_mix"] = U.season_2025.value_counts().to_dict()
Y["season25_mix_multi"] = U[U.n_leagues >= 2].season_2025.value_counts().to_dict()

# (g) distinctiveness per league (mean |percentile - 0.5| across key metrics) vs Brett's tenure there
core = json.load(open(os.path.join(OUT, "analysis_core.json")))
PL = pd.DataFrame(core["per_league"])
keys = ["age", "rookie", "QB", "RB", "TE", "R2", "fcs_below", "established", "age28plus", "projection"]
dd = []
tenure = {"Dynasty Bois": 2022, "Awesome": 2023, "Brokeback": 2023, "Big Show": 2023, "NOWL": 2025, "DynastyMaxxing": 2026}
for l in LO:
    x = PL[(PL.league == l) & PL.metric.isin(keys)]
    pctile = 1 - (x.rank_high - 1) / (x.n_rosters - 1)
    dd.append(dict(league=l, joined=tenure[l], distinct=float((pctile - 0.5).abs().mean() * 2)))
Y["distinctiveness"] = dd
json.dump(Y, open(os.path.join(OUT, "analysis_more.json"), "w"), default=lambda o: None if (isinstance(o, float) and np.isnan(o)) else (o.item() if hasattr(o, "item") else str(o)))
pd.set_option("display.width", 250)
for k in ["posthype_young", "value_by_pos", "te_by_tep", "prod_buckets", "distinctiveness", "elite_by_pos"]:
    print(f"\n{k}:"); print(pd.DataFrame(Y[k]).round(3).to_string())
for k in ["posthype_share", "fcs_split", "fcs_counts", "age_excl_32team", "age_excl_bois", "age_only_32team", "leash_fisher", "top64_share_yr3plus_all", "season25_mix", "season25_mix_multi"]:
    print(f"\n{k}:", Y[k])
print(pd.DataFrame(Y["posthype_young_examples"]).to_string()); print(pd.DataFrame(Y["top_producers_2025"]).to_string())
