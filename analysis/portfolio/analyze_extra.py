"""History/market analyses: NFL-team exposure, post-hype buying, rookie-draft reach, activity, tenure, picks,
same-team concentration, roster similarity, outliers, blind spots."""
import json, os
import numpy as np, pandas as pd
from scipy import stats
from common import *
from load import load, my_unique

rng = np.random.default_rng(7)
S, P = load()
U = pd.read_parquet(os.path.join(OUT, "my_unique.parquet"))
core = json.load(open(os.path.join(OUT, "analysis_core.json")))
LO = [l for l, _, _ in LEAGUES]
SF = {l: f["sf"] for l, _, f in LEAGUES}
X = {}
mine = S[S.is_me]

# ---------- NFL team exposure ----------
cat = pd.DataFrame(core["cat_nfl_team"])
raw = cat[cat.view == "raw"].set_index("category")
t = mine.groupby("nfl_team").agg(unique=("sleeper_id", "nunique"), instances=("sleeper_id", "size"), leagues=("league", "nunique"),
                                 positions=("pos", lambda s: ", ".join(f"{p}×{n}" for p, n in s.value_counts().items())),
                                 players=("name", lambda s: ", ".join(f"{n} ({c})" if c > 1 else n for n, c in s.value_counts().items())),
                                 value=("fc_portfolio", "sum"))
allteams = sorted(set(S.nfl_team))
t = t.reindex(allteams).fillna({"unique": 0, "instances": 0, "leagues": 0, "positions": "", "players": "", "value": 0})
t["pct_instances"] = t.instances / len(mine); t["pct_unique"] = t.unique / mine.sleeper_id.nunique()
t["pct_value"] = t.value / mine.fc_portfolio.sum()
t["expected"] = raw.expected.reindex(t.index); t["lo"] = raw.lo.reindex(t.index); t["hi"] = raw.hi.reindex(t.index)
t["ratio"] = t.instances / t.expected; t["p_hi"] = raw.p_hi.reindex(t.index); t["p_lo"] = raw.p_lo.reindex(t.index)
X["nfl_team"] = t.reset_index().rename(columns={"index": "nfl_team"}).sort_values("instances", ascending=False).round(4).to_dict("records")

# ---------- activity: trades / adds per roster-season, tenure ----------
Aev = pd.read_parquet(os.path.join(OUT, "tx_activity.parquet"))
E = pd.read_parquet(os.path.join(OUT, "add_events.parquet"))
own = E[["league", "season", "roster_id", "roster_owner"]].drop_duplicates()
Aev = Aev.merge(own, on=["league", "season", "roster_id"], how="left")
my_seasons = own[own.roster_owner == ME][["league", "season"]].drop_duplicates()
Ain = Aev.merge(my_seasons, on=["league", "season"])            # only league-seasons Brett was in
act = Ain.groupby(["league", "season", "roster_id", "roster_owner", "type"]).tid.nunique().unstack(fill_value=0).reset_index()
rosters_ls = own.merge(my_seasons, on=["league", "season"]).dropna(subset=["roster_owner"])
act = rosters_ls.merge(act, on=["league", "season", "roster_id", "roster_owner"], how="left").fillna(0)
act["me"] = act.roster_owner == ME
cols = [c for c in ["Trade", "Waiver claim", "Free-agent add"] if c in act]
per = act.groupby(["league", "me"])[cols].mean().round(2)
X["activity_by_league"] = per.reset_index().to_dict("records")
tot = act.groupby("me")[cols].mean()
X["activity_overall"] = tot.round(3).reset_index().to_dict("records")
# percentile of Brett's trade rate within each league-season
pct = []
for (l, s), g in act.groupby(["league", "season"]):
    if g.me.any():
        v = g[g.me].Trade.iloc[0]; pct.append(dict(league=l, season=int(s), brett_trades=v, league_mean=g[~g.me].Trade.mean(), rank=int((g.Trade > v).sum() + 1), n=len(g)))
X["trade_rank"] = pct
X["tenure"] = S.groupby("is_me").days_held.describe().round(1).reset_index().to_dict("records")
X["method_by_league"] = pd.crosstab([S.league, S.is_me], S.method, normalize="index").round(3).reset_index().to_dict("records")

# ---------- post-hype buying: value at acquisition vs the player's prior peak ----------
H = pd.read_parquet(os.path.join(OUT, "dp_value_history.parquet"))
ids = pd.read_csv(os.path.join(RAW, "market", "db_playerids.csv"), dtype=str)
s2fp = ids[ids.sleeper_id.notna() & (ids.sleeper_id != "NA")].drop_duplicates("sleeper_id").set_index("sleeper_id").fantasypros_id
Ev = E[E.method.isin(["Trade", "Waiver claim", "Free-agent add"])].merge(my_seasons, on=["league", "season"]).copy()
Ev["fp_id"] = Ev.player_id.map(s2fp)
Ev = Ev.dropna(subset=["fp_id", "date"])
Ev["sf"] = Ev.league.map(SF)
Hs = H.sort_values("date")
res = []
Hg = {k: g for k, g in Hs.groupby("fp_id")}
for r in Ev.itertuples():
    g = Hg.get(r.fp_id)
    if g is None: continue
    col = "value_2qb" if r.sf else "value_1qb"
    before = g[g.date <= r.date]
    if len(before) < 3: continue
    v, peak = before[col].iloc[-1], before[col].max()
    res.append(dict(league=r.league, season=r.season, me=r.roster_owner == ME, method=r.method, player_id=r.player_id, v=v, peak=peak,
                    pct_of_peak=v / peak if peak > 0 else np.nan, peak_date=before.date[before[col].idxmax()], date=r.date))
PH = pd.DataFrame(res)
PH = PH.merge(P[["sleeper_id", "name", "draft_pick", "drafted", "pos"]], left_on="player_id", right_on="sleeper_id", how="left")
dp_all = pd.read_parquet(os.path.join(BRETT_RAW, "draft_picks.parquet"))
ids2 = ids.drop_duplicates("sleeper_id").set_index("sleeper_id")
PH["draft_ovr"] = pd.to_numeric(PH.player_id.map(ids2.draft_ovr), errors="coerce")
PH["name"] = PH.name.fillna(PH.player_id.map(ids2["name"]))
meaningful = PH[PH.peak >= 1500]
out = []
for lab, d in [("All acquisitions (peak value ≥1500)", meaningful), ("Trades only", meaningful[meaningful.method == "Trade"]),
               ("Top-64 NFL picks only", meaningful[meaningful.draft_ovr <= 64])]:
    a, b = d[d.me].pct_of_peak, d[~d.me].pct_of_peak
    out.append(dict(subset=lab, n_brett=len(a), n_others=len(b), brett_median=a.median(), others_median=b.median(),
                    brett_share_le60=(a <= 0.6).mean(), others_share_le60=(b <= 0.6).mean(),
                    brett_share_le50=(a <= 0.5).mean(), others_share_le50=(b <= 0.5).mean(), p_mwu=stats.mannwhitneyu(a, b).pvalue if len(a) and len(b) else None))
X["posthype"] = out
X["posthype_examples"] = meaningful[meaningful.me & (meaningful.pct_of_peak <= 0.5)].sort_values("peak", ascending=False).head(25)[
    ["name", "league", "method", "date", "v", "peak", "pct_of_peak", "peak_date"]].astype(str).to_dict("records")

# ---------- rookie-draft picks vs consensus rookie rank at draft time ----------
RD = E[E.method == "Rookie draft"].merge(my_seasons, on=["league", "season"]).copy()
RD["fp_id"] = RD.player_id.map(s2fp)
rk = []
for (l, s), g in RD.groupby(["league", "season"]):
    col = "value_2qb" if SF[l] else "value_1qb"
    snapdate = H.date[H.date <= g.date.min()].max()
    snap = H[H.date == snapdate]
    rook = ids[ids.draft_year == str(s)].fantasypros_id.dropna()
    cand = snap[snap.fp_id.isin(set(rook))].sort_values(col, ascending=False).reset_index(drop=True)
    crank = {fp: i + 1 for i, fp in enumerate(cand.fp_id)}
    for r in g.itertuples():
        cr = crank.get(r.fp_id, len(cand) + 1)
        rk.append(dict(league=l, season=s, me=r.roster_owner == ME, pick_no=r.pick_no, consensus_rank=cr, ranked=r.fp_id in crank,
                       reach=cr - r.pick_no, player_id=r.player_id, snap=str(snapdate.date())))
RK = pd.DataFrame(rk)
RK["name"] = RK.player_id.map(ids2["name"])
X["rookie_reach"] = [dict(who="Brett" if w else "League-mates", n=len(d), median_reach=d.reach.median(), mean_reach=d.reach.mean(),
                          share_reach_gt5=(d.reach > 5).mean(), share_value_gt5=(d.reach < -5).mean(), share_unranked=(~d.ranked).mean())
                     for w, d in RK.groupby("me")]
X["rookie_reach_p"] = stats.mannwhitneyu(RK[RK.me].reach, RK[~RK.me].reach).pvalue
my_multi = set(U[U.n_leagues >= 2].sleeper_id)
X["rookie_reach_multi"] = RK[RK.me & RK.player_id.isin(my_multi) & (RK.season == 2026)].sort_values("name")[
    ["name", "league", "pick_no", "consensus_rank", "reach"]].to_dict("records")

# ---------- future picks owned (2027-29) ----------
pk = []
for l, lid, f in LEAGUES:
    L = json.load(open(os.path.join(RAW, "sleeper", "current", f"league_{lid}.json")))
    Rr = json.load(open(os.path.join(RAW, "sleeper", "current", f"rosters_{lid}.json")))
    TP = json.load(open(os.path.join(RAW, "sleeper", "current", f"traded_picks_{lid}.json")))
    owner = {(p["season"], p["round"], p["roster_id"]): p["owner_id"] for p in TP}
    rounds = L["settings"]["draft_rounds"]
    cnt = {r["roster_id"]: dict(firsts=0, seconds=0, total=0) for r in Rr}
    for season in ("2027", "2028", "2029"):
        for rd in range(1, rounds + 1):
            for r in Rr:
                o = owner.get((season, rd, r["roster_id"]), r["roster_id"])
                if o in cnt:
                    cnt[o]["total"] += 1; cnt[o]["firsts"] += rd == 1; cnt[o]["seconds"] += rd == 2
    myr = next(r["roster_id"] for r in Rr if r.get("owner_id") == ME)
    df = pd.DataFrame(cnt).T
    pk.append(dict(league=l, rounds=rounds, brett_firsts=int(df.loc[myr, "firsts"]), brett_seconds=int(df.loc[myr, "seconds"]), brett_total=int(df.loc[myr, "total"]),
                   league_avg_total=df.total.mean(), rank_total=int((df.total > df.loc[myr, "total"]).sum() + 1),
                   rank_firsts=int((df.firsts > df.loc[myr, "firsts"]).sum() + 1), n=len(df)))
X["picks"] = pk

# ---------- same-NFL-team concentration within a fantasy roster ----------
conc = []
for (l, rid), g in S[S.nfl_team != "FA"].groupby(["league", "roster_id"]):
    vc = g.nfl_team.value_counts()
    qb_teams = set(g[g.pos == "QB"].nfl_team)
    stacks = int(g[g.pos.isin(["WR", "TE"]) & g.nfl_team.isin(qb_teams)].shape[0])
    conc.append(dict(league=l, roster_id=rid, me=bool(g.is_me.iloc[0]), max_same_team=int(vc.max()), same_team_pairs=int((vc * (vc - 1) / 2).sum()),
                     qb_stack_catchers=stacks, n=len(g), top_team=vc.index[0]))
CC = pd.DataFrame(conc)
cc = []
for l, g in CC.groupby("league"):
    m = g[g.me].iloc[0]; o = g[~g.me]
    cc.append(dict(league=l, max_same_team=int(m.max_same_team), top_team=m.top_team, league_avg_max=o.max_same_team.mean(), pairs=int(m.same_team_pairs),
                   league_avg_pairs=o.same_team_pairs.mean(), pairs_rank=int((g.same_team_pairs > m.same_team_pairs).sum() + 1),
                   stacks=int(m.qb_stack_catchers), league_avg_stacks=o.qb_stack_catchers.mean(), n=len(g)))
X["same_team"] = cc
# teammates Brett owns together on the same fantasy roster
tm = mine[mine.nfl_team != "FA"].groupby(["league", "nfl_team"]).name.agg(list)
X["teammate_groups"] = [dict(league=l, nfl_team=t_, players=v) for (l, t_), v in tm.items() if len(v) >= 3]

# ---------- similarity between Brett's six rosters vs random league-mate pairs ----------
sets = {l: set(mine[mine.league == l].sleeper_id) for l in LO}
others = {l: [set(g.sleeper_id) for _, g in S[(S.league == l) & ~S.is_me].groupby("roster_id")] for l in LO}
jac = []
for i, a in enumerate(LO):
    for b in LO[i + 1:]:
        j = len(sets[a] & sets[b]) / len(sets[a] | sets[b])
        null = [len(x & y) / len(x | y) for x, y in ((others[a][rng.integers(len(others[a]))], others[b][rng.integers(len(others[b]))]) for _ in range(3000))]
        jac.append(dict(a=a, b=b, shared=len(sets[a] & sets[b]), jaccard=j, null_mean=float(np.mean(null)), null_hi=float(np.percentile(null, 97.5)),
                        p=float((np.array(null) >= j).mean())))
X["jaccard"] = jac

# ---------- concentration ----------
w = U.n_leagues / U.n_leagues.sum()
tm_inst = mine.nfl_team.value_counts(normalize=True)
lm_inst = S[~S.is_me].nfl_team.value_counts(normalize=True)
vals = mine.fc_portfolio.sort_values(ascending=False)
X["concentration"] = dict(player_hhi=float((w ** 2).sum()), eff_players=float(1 / (w ** 2).sum()), n_unique=len(U), n_spots=len(mine),
                          team_hhi=float((tm_inst ** 2).sum()), team_eff=float(1 / (tm_inst ** 2).sum()),
                          lm_team_eff=float(1 / (lm_inst ** 2).sum()),
                          top5_value_share=float(U.sort_values("fc_portfolio", ascending=False).fc_portfolio.head(5).sum() / U.fc_portfolio.sum()),
                          top10_value_share=float(U.sort_values("fc_portfolio", ascending=False).fc_portfolio.head(10).sum() / U.fc_portfolio.sum()),
                          instance_top10_share=float(vals.head(10).sum() / vals.sum()))

# ---------- position-specific age vs league-mates (same league, same position) ----------
pa = []
for p in ["QB", "RB", "WR", "TE"]:
    d = []
    for l in LO:
        L = S[(S.league == l) & (S.pos == p)]
        if L.is_me.any(): d.append((L[L.is_me].age.mean() - L[~L.is_me].age.mean(), L.is_me.sum()))
    diff = np.average([x for x, _ in d], weights=[n for _, n in d])
    pa.append(dict(pos=p, brett_mean=mine[mine.pos == p].age.mean(), lm_mean=S[~S.is_me & (S.pos == p)].age.mean(), within_league_diff=diff,
                   leagues_younger=sum(x < 0 for x, _ in d), leagues=len(d)))
X["pos_age"] = pa

# ---------- draft class concentration ----------
dc = mine.draft_year.fillna(mine.rookie_season).astype(int).value_counts(normalize=True).sort_index()
dcl = S[~S.is_me].draft_year.fillna(S[~S.is_me].rookie_season).astype(int).value_counts(normalize=True).sort_index()
X["draft_class"] = pd.DataFrame({"brett": dc, "league_mates": dcl}).fillna(0).loc[2018:].round(4).reset_index().rename(columns={"index": "class"}).to_dict("records")

# ---------- 'leash' test: unproductive year-3+ players, by draft capital ----------
lp = S[(S.nfl_season_num >= 3) & (S.starter_finishes == 0)].copy()
lp["capital_grp"] = np.where(lp.draft_pick <= 64, "Top-64 pick", "Pick 65+ / UDFA")
lt = lp.groupby(["is_me", "capital_grp"]).agg(n=("name", "size"), days=("days_held", "median")).reset_index()
share = lp.groupby("is_me").apply(lambda g: (g.capital_grp == "Top-64 pick").mean())
X["leash"] = dict(table=lt.to_dict("records"), brett_top64_share=float(share.get(True)), lm_top64_share=float(share.get(False)),
                  brett_n=int((lp.is_me).sum()), all_spot_share_brett=float((mine.nfl_season_num >= 3).mean()))

# ---------- athleticism & college production (within position, vs league-mates) ----------
ath = []
for var in ["forty", "speed_score", "hass", "cfb_dominator", "cfb_breakout_age", "rookie_age", "height_in", "weight_lb"]:
    for p in ["RB", "WR", "TE", "QB"]:
        a, b = S[S.is_me & (S.pos == p)][var].dropna(), S[~S.is_me & (S.pos == p)][var].dropna()
        if len(a) >= 5 and len(b) >= 20:
            ath.append(dict(var=var, pos=p, brett=a.mean(), lm=b.mean(), n_brett=len(a), n_lm=len(b), p=stats.mannwhitneyu(a, b).pvalue))
X["athletic"] = ath

# ---------- taxi / IR usage ----------
X["slots"] = pd.crosstab(S.is_me, S.slot, normalize="index").round(3).reset_index().to_dict("records")

# ---------- college breakdown for Brett ----------
X["schools"] = U.groupby("school").agg(players=("name", "size"), instances=("n_leagues", "sum"), names=("name", lambda s: ", ".join(s))).sort_values(["instances", "players"], ascending=False).reset_index().to_dict("records")
X["ndsu_like"] = U[U.conf_tier.isin(["FCS", "D-II", "D-III"])][["name", "school", "conf", "college_level", "n_leagues", "capital"]].to_dict("records")

# ---------- blind spots: elite players owned nowhere ----------
elite = P[P.fc_portfolio_rank <= 36].copy()
elite["owned"] = elite.sleeper_id.isin(set(mine.sleeper_id))
exp_elite = sum(1 / f["teams"] for _, _, f in LEAGUES) * len(elite)
X["elite"] = dict(n=len(elite), owned=int(elite.owned.sum()), instances=int(mine[mine.fc_portfolio_rank <= 36].shape[0]), expected_instances=exp_elite,
                  owned_names=list(elite[elite.owned].name), not_owned=list(elite[~elite.owned].sort_values("fc_portfolio_rank").name))
vp = P[(P.age >= 28) & P.established_starter.astype(bool)]
X["vet_producers"] = dict(universe=len(vp), owned=int(vp.sleeper_id.isin(set(mine.sleeper_id)).sum()), names=list(vp[vp.sleeper_id.isin(set(mine.sleeper_id))].name))

# ---------- outliers: typicality vs Brett's own portfolio ----------
Z = U.copy()
Z["log_pick"] = np.log(Z.draft_pick.fillna(263)); Z["log_v"] = np.log1p(Z.fc_portfolio)
zc = {}
for c in ["age", "log_pick", "log_v", "nfl_season_num"]:
    zc[c] = (Z[c] - Z[c].mean()) / Z[c].std()
Zm = pd.DataFrame(zc)
Z["atypical"] = np.sqrt((Zm ** 2).sum(axis=1))
Z["why"] = [", ".join(f"{k} z={v:+.1f}" for k, v in row.items() if abs(v) >= 1.5) for _, row in Zm.iterrows()]
X["outliers"] = Z.sort_values("atypical", ascending=False).head(15)[["name", "pos", "age", "capital", "school", "conf_tier", "fc_portfolio_rank", "n_leagues", "leagues", "atypical", "why"]].round(2).to_dict("records")

json.dump(X, open(os.path.join(OUT, "analysis_extra.json"), "w"), default=lambda o: None if (isinstance(o, float) and np.isnan(o)) else (o.item() if hasattr(o, "item") else str(o)))
pd.set_option("display.width", 250); pd.set_option("display.max_colwidth", 80)
print("NFL TEAMS:"); print(pd.DataFrame(X["nfl_team"])[["nfl_team", "unique", "instances", "leagues", "expected", "ratio", "p_hi", "p_lo", "pct_value", "positions"]].round(3).head(40).to_string())
print("\nACTIVITY:", X["activity_overall"]); print(pd.DataFrame(X["activity_by_league"]).to_string())
print("\nTRADE RANK:"); print(pd.DataFrame(X["trade_rank"]).to_string())
print("\nTENURE:", X["tenure"])
print("\nPOSTHYPE:"); print(pd.DataFrame(X["posthype"]).round(3).to_string())
print(pd.DataFrame(X["posthype_examples"]).to_string())
print("\nROOKIE REACH:", X["rookie_reach"], "p=", X["rookie_reach_p"]); print(pd.DataFrame(X["rookie_reach_multi"]).to_string())
print("\nPICKS:"); print(pd.DataFrame(X["picks"]).to_string())
print("\nSAME TEAM:"); print(pd.DataFrame(X["same_team"]).to_string()); print(X["teammate_groups"])
print("\nJACCARD:"); print(pd.DataFrame(X["jaccard"]).round(3).to_string())
print("\nCONC:", X["concentration"])
print("\nPOS AGE:"); print(pd.DataFrame(X["pos_age"]).round(2).to_string())
print("\nDRAFT CLASS:"); print(pd.DataFrame(X["draft_class"]).to_string())
print("\nLEASH:", X["leash"])
print("\nATHLETIC:"); print(pd.DataFrame(X["athletic"]).round(3).to_string())
print("\nSLOTS:", X["slots"])
print("\nSCHOOLS:"); print(pd.DataFrame(X["schools"]).head(15).to_string())
print("\nELITE:", X["elite"]); print("VET PRODUCERS:", X["vet_producers"])
print("\nOUTLIERS:"); print(pd.DataFrame(X["outliers"]).to_string())
