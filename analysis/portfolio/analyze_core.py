"""Core analysis: overlap, exposures, distributions vs a null of synthetic portfolios, correlations, logistic model."""
import json, os
import numpy as np, pandas as pd
from scipy import stats
import statsmodels.api as sm
import statsmodels.formula.api as smf
from common import *
from load import load, my_unique

rng = np.random.default_rng(20260922)
S, P = load()
U = my_unique(S)
LEAGUE_ORDER = [l for l, _, _ in LEAGUES]
R = {}

# ---------- player-level feature arrays (index = position in PI) ----------
PI = S.drop_duplicates("sleeper_id").set_index("sleeper_id")
pid_idx = {p: i for i, p in enumerate(PI.index)}
S["pidx"] = S.sleeper_id.map(pid_idx)
F = pd.DataFrame(index=PI.index)
F["age"] = PI.age
F["rookie"] = PI.nfl_season_num <= 1
F["yr2"] = PI.nfl_season_num == 2
F["yr3"] = PI.nfl_season_num == 3
F["vet4"] = PI.nfl_season_num >= 4
for p in ["QB", "RB", "WR", "TE"]: F[p] = PI.pos == p
F["R1"] = PI.draft_round == 1
F["top10"] = PI.capital == "R1 top-10"
F["R2"] = PI.draft_round == 2
F["R3"] = PI.draft_round == 3
F["day2"] = PI.draft_round.isin([2, 3])
F["day3"] = PI.draft_round.between(4, 7)
F["UDFA"] = ~PI.drafted
F["top64"] = PI.drafted & (PI.draft_pick <= 64)
F["power"] = PI.conf_tier == "Power"
F["g5"] = PI.conf_tier.isin(["Group of Five", "FBS Independent"])
F["fcs_below"] = PI.conf_tier.isin(["FCS", "D-II", "D-III", "No football"])
F["sec"] = PI.conf == "SEC"; F["b10"] = PI.conf == "Big Ten"; F["b12"] = PI.conf == "Big 12"; F["acc"] = PI.conf == "ACC"
F["pac"] = PI.conf.isin(["Pac-12", "Pac-10"])
F["former_pac12"] = PI.former_pac12.astype(bool)
F["established"] = PI.established_starter.astype(bool)
F["starter25"] = PI.starter_2025.astype("boolean").fillna(False).astype(bool)
F["elite_tier"] = PI.value_tier == "1 Elite"
F["top100"] = PI.value_tier.isin(["1 Elite", "2 High-value starter"])
F["fc_value"] = PI.fc_portfolio
F["dp_value"] = PI.dp_portfolio
F["injured_now"] = PI.role_2026 == "Injured / reserve"
F["projection"] = (PI.nfl_season_num <= 3) & (PI.starter_finishes == 0)
F["rising"] = PI.value_trend == "Rising"; F["falling"] = PI.value_trend == "Falling"
F["declined_prospect"] = PI.archetype == "Former top prospect, value declined"
F["late_bloomer"] = PI.archetype == "Late-blooming producer"
F["age28plus"] = PI.age >= 28
F["vet_producer"] = (PI.age >= 28) & PI.established_starter.astype(bool)
F["backup_role"] = PI.role_2026.isin(["Reserve (<30%)", "Backup / no offensive snaps", "Practice squad"])
FV = F.astype(float).values
FCOLS = list(F.columns)

def summarize_idx(idx):
    x = FV[idx]
    return np.nanmean(x, axis=0)

# ---------- three views for Brett ----------
mine = S[S.is_me]
raw_me = summarize_idx(mine.pidx.values)
uniq_me = summarize_idx(np.unique(mine.pidx.values))
norm_me = np.mean([summarize_idx(mine[mine.league == l].pidx.values) for l in LEAGUE_ORDER], axis=0)
med_age = dict(raw=mine.age.median(), unique=U.age.median(), norm=np.mean([mine[mine.league == l].age.median() for l in LEAGUE_ORDER]))

# ---------- null: synthetic portfolios = one random league-mate roster per league ----------
rosters = {l: [g.pidx.values for _, g in S[(S.league == l) & ~S.is_me].groupby("roster_id")] for l in LEAGUE_ORDER}
N = 10000
sim_raw, sim_uniq, sim_norm, sim_dup, sim_multi = [], [], [], [], []
sim_idx_raw, sim_idx_uniq = [], []
for _ in range(N):
    picks = [rosters[l][rng.integers(len(rosters[l]))] for l in LEAGUE_ORDER]
    allidx = np.concatenate(picks)
    u, c = np.unique(allidx, return_counts=True)
    sim_raw.append(summarize_idx(allidx)); sim_uniq.append(summarize_idx(u))
    sim_norm.append(np.mean([summarize_idx(p) for p in picks], axis=0))
    sim_dup.append(1 - len(u) / len(allidx)); sim_multi.append((c >= 2).mean())
    sim_idx_raw.append(allidx); sim_idx_uniq.append(u)
sim_raw, sim_uniq, sim_norm = map(np.array, (sim_raw, sim_uniq, sim_norm))

def cmp(me, sim):
    lo, hi = np.nanpercentile(sim, [2.5, 97.5], axis=0)
    pct = np.array([(sim[:, j] < me[j]).mean() + 0.5 * (sim[:, j] == me[j]).mean() for j in range(len(me))])
    return pd.DataFrame({"brett": me, "null_mean": np.nanmean(sim, axis=0), "null_lo": lo, "null_hi": hi, "pctile": pct}, index=FCOLS)
views = {"raw": cmp(raw_me, sim_raw), "unique": cmp(uniq_me, sim_uniq), "norm": cmp(norm_me, sim_norm)}
R["views"] = {k: v.round(4).reset_index().rename(columns={"index": "metric"}).to_dict("records") for k, v in views.items()}
R["median_age"] = med_age
R["dup"] = dict(brett_dup_share=1 - len(U) / len(mine), brett_multi_share=(U.n_leagues >= 2).mean(),
                null_dup_mean=float(np.mean(sim_dup)), null_dup_hi=float(np.percentile(sim_dup, 97.5)), null_dup_max=float(np.max(sim_dup)),
                null_multi_mean=float(np.mean(sim_multi)), null_multi_hi=float(np.percentile(sim_multi, 97.5)),
                p_dup=float((np.array(sim_dup) >= 1 - len(U) / len(mine)).mean()))

# categorical distributions vs null (counts in raw spots and unique players)
def cat_table(col, cats=None):
    v = PI[col].astype(str).values
    cats = cats or sorted(set(v))
    code = np.array([cats.index(x) if x in cats else -1 for x in v])
    def counts(idx): c = code[idx]; return np.bincount(c[c >= 0], minlength=len(cats))
    out = []
    for view, me_idx, sims in [("raw", mine.pidx.values, sim_idx_raw), ("unique", np.unique(mine.pidx.values), sim_idx_uniq)]:
        mc = counts(me_idx); tot = len(me_idx)
        sc = np.array([counts(i) / len(i) * tot for i in sims])       # null counts rescaled to Brett's total
        for j, cat in enumerate(cats):
            out.append(dict(view=view, category=cat, brett=int(mc[j]), brett_share=mc[j] / tot, expected=sc[:, j].mean(),
                            lo=np.percentile(sc[:, j], 2.5), hi=np.percentile(sc[:, j], 97.5),
                            ratio=mc[j] / sc[:, j].mean() if sc[:, j].mean() > 0 else np.nan,
                            p_hi=(sc[:, j] >= mc[j]).mean(), p_lo=(sc[:, j] <= mc[j]).mean()))
    return pd.DataFrame(out)
for col in ["nfl_team", "pos", "age_bucket", "exp_group", "capital", "day", "conf", "conf_tier", "school", "archetype", "value_tier",
            "season_2025", "role_2026", "value_trend", "college_level"]:
    R[f"cat_{col}"] = cat_table(col).round(4).to_dict("records")

# ---------- overlap table ----------
U["pos_ok"] = U.pos
def p_ge(row):
    # Poisson-binomial P(count >= observed) if a random manager held each rostered instance with prob 1/N
    ps = [1 / n for n in S[S.sleeper_id == row.sleeper_id].drop_duplicates("league").n_teams]
    dist = np.array([1.0])
    for p in ps: dist = np.convolve(dist, [1 - p, p])
    return dist[int(row.n_leagues):].sum()
U["p_chance"] = U.apply(p_ge, axis=1)
fmt = S[S.is_me].groupby("sleeper_id").agg(sf=("fmt_sf", lambda s: set(s)), size=("fmt_teams", lambda s: set(s)))
U["cross_format"] = U.sleeper_id.map(fmt.sf.map(lambda s: len(s) > 1))
U["cross_depth"] = U.sleeper_id.map(fmt["size"].map(lambda s: (32 in s) and (min(s) <= 12)))
U["active_acq"] = U.methods.str.count("Trade|Waiver claim|Free-agent add")
U["pes"] = U.n_leagues + 0.5 * U.cross_format + 0.5 * U.cross_depth
held = S[S.is_me].groupby("sleeper_id").days_held.median()
U["median_days_held"] = U.sleeper_id.map(held)
U.to_parquet(os.path.join(OUT, "my_unique.parquet"))
keep = ["name", "pos", "nfl_team", "n_leagues", "leagues", "teams", "slots", "methods", "age", "birth_date", "nfl_season_num", "draft_year", "draft_round",
        "draft_pick", "capital", "school", "conf", "conf_tier", "college_level", "rookie_age", "role_2026", "snap_pct_2026", "injury_status",
        "ppr_2025", "games_2025", "rank_2025", "season_2025", "career_ppr", "starter_finishes", "elite_finishes", "best_rank", "ppr_2026",
        "fc_portfolio", "fc_portfolio_rank", "fc_sf12_rank", "fc_1qb12_rank", "dp_portfolio", "dp_portfolio_rank", "value_tier", "value_tier_dp",
        "value_trend", "dp_chg_since_draft", "dp_chg_1y", "dp_pct_of_peak", "archetype", "n_leagues_rostered", "expected_random", "lift",
        "p_chance", "cross_format", "cross_depth", "active_acq", "pes", "median_days_held", "height_in", "weight_lb", "forty", "speed_score",
        "cfb_dominator", "cfb_breakout_age"]
master = U.sort_values(["n_leagues", "fc_portfolio"], ascending=False)[keep]
master.to_csv(os.path.join(OUT, "master_players.csv"), index=False)
R["overlap"] = master.round(3).astype(object).where(master.notna(), None).to_dict("records")

# ---------- correlations: ownership count vs attributes (unique players) ----------
def perm_spearman(x, y, n=10000):
    m = ~(np.isnan(x) | np.isnan(y)); x, y = x[m], y[m]
    r = stats.spearmanr(x, y).correlation
    perm = np.array([stats.spearmanr(x, rng.permutation(y)).correlation for _ in range(n)])
    boots = []
    for _ in range(2000):
        b = rng.integers(len(x), size=len(x)); boots.append(stats.spearmanr(x[b], y[b]).correlation)
    return dict(rho=r, p_perm=(np.abs(perm) >= abs(r)).mean(), ci_lo=np.nanpercentile(boots, 2.5), ci_hi=np.nanpercentile(boots, 97.5), n=int(m.sum()))
Uc = U.copy()
Uc["draft_pick_filled"] = Uc.draft_pick.fillna(263)          # UDFA ranked after the last pick
Uc["draft_round_filled"] = Uc.draft_round.fillna(8)
Uc["log_fc"] = np.log1p(Uc.fc_portfolio)
Uc["pos_value_rank"] = Uc.groupby("pos").fc_portfolio.rank(ascending=False)
Uc["ppr_2025_0"] = Uc.ppr_2025.fillna(0)
tests = [("age", "Age"), ("draft_pick_filled", "NFL draft pick (UDFA = 263)"), ("draft_round_filled", "NFL draft round (UDFA = 8)"),
         ("ppr_2025", "2025 PPR points (players who played)"), ("ppr_2025_0", "2025 PPR points (0 if none)"), ("log_fc", "FantasyCalc value (log)"),
         ("dp_portfolio", "DynastyProcess value"), ("nfl_season_num", "NFL season number (1 = rookie)"), ("rookie", "Rookie (1/0)"),
         ("fc_portfolio_rank", "Portfolio value rank"), ("career_ppr", "Career PPR points"), ("starter_finishes", "Career starter-level finishes")]
Uc["rookie"] = (Uc.nfl_season_num <= 1).astype(float)
R["corr"] = [dict(var=lab, **perm_spearman(Uc[v].astype(float).values, Uc.n_leagues.astype(float).values)) for v, lab in tests]
# group comparisons multi (2+) vs single
g = Uc.assign(multi=Uc.n_leagues >= 2)
comp = []
for v, lab in [("age", "Age"), ("draft_pick_filled", "Draft pick"), ("fc_portfolio", "FantasyCalc value"), ("ppr_2025_0", "2025 PPR"), ("nfl_season_num", "NFL season #")]:
    a, b = g[g.multi][v].astype(float).dropna(), g[~g.multi][v].astype(float).dropna()
    comp.append(dict(var=lab, multi_mean=a.mean(), multi_median=a.median(), single_mean=b.mean(), single_median=b.median(),
                     n_multi=len(a), n_single=len(b), p_mwu=stats.mannwhitneyu(a, b).pvalue))
for v, lab in [("rookie", "Rookie share"), ("R1", "First-round share")]:
    col = (g.nfl_season_num <= 1) if v == "rookie" else (g.draft_round == 1)
    t = pd.crosstab(g.multi, col)
    comp.append(dict(var=lab, multi_mean=col[g.multi].mean(), single_mean=col[~g.multi].mean(), n_multi=int(g.multi.sum()), n_single=int((~g.multi).sum()),
                     p_mwu=stats.fisher_exact(t.values)[1] if t.shape == (2, 2) else np.nan))
R["multi_vs_single"] = comp
# position duplication
R["pos_dup"] = Uc.groupby("pos").agg(players=("name", "size"), multi=("n_leagues", lambda s: (s >= 2).sum()), mean_n=("n_leagues", "mean")).reset_index().to_dict("records")

# ---------- within-league logistic model: P(on Brett's roster | rostered in league) ----------
D = S.copy()
D["y"] = D.is_me.astype(int)
D["age_z"] = (D.age - D.age.mean()) / D.age.std()
D["logv"] = np.log1p(D.fc_portfolio); D["logv_z"] = (D.logv - D.logv.mean()) / D.logv.std()
D["cap"] = pd.Categorical(np.select([D.draft_round == 1, D.draft_round.isin([2, 3]), D.draft_round.between(4, 7)], ["Day1", "Day2", "Day3"], "UDFA"), categories=["Day2", "Day1", "Day3", "UDFA"])
D["exp"] = pd.Categorical(D.exp_group, categories=["Veteran (4+)", "Rookie", "2nd year", "3rd year"])
D["posc"] = pd.Categorical(D.pos, categories=["WR", "QB", "RB", "TE"])
D["tierc"] = pd.Categorical(D.conf_tier.where(D.conf_tier.isin(["Power", "Group of Five", "FCS"]), "Other"), categories=["Power", "Group of Five", "FCS", "Other"])
D = D.dropna(subset=["age_z", "logv_z"])
D = D[D.pos != "Other"].copy()
models = {}
for name, f in [("m1_age_value", "y ~ C(league) + age_z + logv_z"),
                ("m2_full", "y ~ C(league) + age_z + logv_z + cap + exp + posc + tierc"),
                ("m3_full_plus_prod", "y ~ C(league) + age_z + logv_z + cap + exp + posc + tierc + established")]:
    D["established"] = D.established_starter.astype(float)
    m = smf.glm(f, data=D, family=sm.families.Binomial()).fit(cov_type="cluster", cov_kwds={"groups": D.sleeper_id.astype("category").cat.codes})
    tab = pd.DataFrame({"coef": m.params, "or": np.exp(m.params), "lo": np.exp(m.conf_int()[0]), "hi": np.exp(m.conf_int()[1]), "p": m.pvalues})
    tab = tab[~tab.index.str.startswith("C(league)") & (tab.index != "Intercept")]
    models[name] = tab.round(4).reset_index().rename(columns={"index": "term"}).to_dict("records")
    print(f"\n== {name}  (n={int(m.nobs)}, Brett spots={int(D.y.sum())})"); print(tab.round(3).to_string())
R["logit"] = models
R["logit_note"] = dict(n=int(len(D)), events=int(D.y.sum()), age_sd=float(S.age.std()), logv_sd=float(np.log1p(S.fc_portfolio).std()))

# ---------- per-league: Brett's roster vs every other roster in that league (percentile) ----------
rows = []
for l in LEAGUE_ORDER:
    L = S[S.league == l]
    FCK = {"Dynasty Bois": "bois", "NOWL": "nowl", "Awesome": "awesome", "Brokeback": "brokeback", "Big Show": "bigshow", "DynastyMaxxing": "maxxing"}
    def roster_summary(g):
        s_ = pd.Series(summarize_idx(g.pidx.values), index=FCOLS)
        s_["n"] = len(g); s_["fc_league_value"] = g["fc_" + FCK[l]].sum(); s_["team"] = g.team.iloc[0]; s_["is_me"] = bool(g.is_me.iloc[0])
        return s_
    per = pd.DataFrame({rid: roster_summary(g) for rid, g in L.groupby("roster_id")}).T
    for c in FCOLS + ["n", "fc_league_value"]:
        per[c] = per[c].astype(float)
    me_row = per[per.is_me.astype(bool)].iloc[0]
    others = per[~per.is_me.astype(bool)]
    for c in FCOLS + ["n", "fc_league_value"]:
        rows.append(dict(league=l, metric=c, brett=me_row[c], league_mean=others[c].mean(),
                         rank_high=int((per[c] > me_row[c]).sum() + 1), n_rosters=len(per)))
PL = pd.DataFrame(rows)
R["per_league"] = PL.round(4).to_dict("records")
json.dump(R, open(os.path.join(OUT, "analysis_core.json"), "w"), default=lambda o: None if (isinstance(o, float) and np.isnan(o)) else (o.item() if hasattr(o, "item") else str(o)))

# ---------- digest ----------
pd.set_option("display.width", 250)
for k, v in views.items():
    print(f"\n=== VIEW: {k} ==="); print(v.round(3).to_string())
print("\nmedian age:", med_age)
print("\nDUP:", R["dup"])
print("\nCORR:"); print(pd.DataFrame(R["corr"]).round(3).to_string())
print("\nMULTI vs SINGLE:"); print(pd.DataFrame(R["multi_vs_single"]).round(3).to_string())
print("\nPOS DUP:", R["pos_dup"])
