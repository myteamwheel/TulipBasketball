"""Ownership-history analysis: every stint, trade, pickup and drop, Brett vs league-mates in the same league-seasons."""
import json, os, glob
import numpy as np, pandas as pd
from scipy import stats
from common import *

H = os.path.join(RAW, "sleeper", "history")
chains = json.load(open(os.path.join(H, "_chains.json")))
FMT = {l: f for l, _, f in LEAGUES}
NOW = pd.Timestamp(AS_OF_DATE)
S = pd.read_parquet(os.path.join(OUT, "stints_enriched.parquet"))
TS = pd.read_parquet(os.path.join(OUT, "trade_sides.parquet"))
W = pd.read_parquet(os.path.join(OUT, "weekly_lineups.parquet"))
RD = pd.read_parquet(os.path.join(OUT, "rookie_picks.parquet"))
FC_ = pd.read_parquet(os.path.join(OUT, "failed_claims.parquet"))
PH = pd.read_parquet(os.path.join(OUT, "players_hist.parquet")).set_index("player_id")
J = lambda c: c.map(json.loads)
for c in ["players_in", "players_out", "picks_in", "picks_out", "partners", "age_in", "age_out", "pos_in", "pos_out"]: TS[c] = J(TS[c])

# Brett's league-seasons + names
mine_ls, names = set(), {}
for label, chain in chains.items():
    for season, lid in chain:
        us = {u["user_id"]: ((u.get("metadata") or {}).get("team_name") or u.get("display_name") or "").strip() for u in json.load(open(os.path.join(H, lid, "users.json")))}
        for u, n in us.items(): names[(label, u)] = n
        if ME in {r.get("owner_id") for r in json.load(open(os.path.join(H, lid, "rosters.json")))}: mine_ls.add((label, int(season)))
inls = lambda df, s="season": df[[(l, int(x)) in mine_ls for l, x in zip(df.league, df[s])]]
Z = {}
Z["league_seasons"] = sorted([f"{l} {s}" for l, s in mine_ls])
Sx = inls(S, "start_season").copy()
Sx["acq"] = ~Sx.start_method.isin(["Inherited (took over team)", "Unrecorded add"])
Sx["reversal"] = (Sx.days * 24 < 1) & (Sx.end_method != "Still rostered")
Z["reversals"] = dict(brett=int(Sx[(Sx.owner == ME)].reversal.sum()), brett_share=float(Sx[(Sx.owner == ME)].reversal.mean()), lm_share=float(Sx[(Sx.owner != ME)].reversal.mean()))
Sx = Sx[~Sx.reversal].copy()
Sx["me"] = Sx.owner == ME
TSx = inls(TS)
Wx = inls(W)
mgr_seasons = Sx.groupby(["league", "owner"]).start_season.agg(lambda s: len(set(s)))

# ---------------- 1. totals ----------------
M = S[S.is_me]
Z["totals"] = dict(stints=len(M), unique_players=int(M.player_id.nunique()), acquisitions=int((~M.start_method.isin(["Inherited (took over team)"])).sum()),
                   inherited=int((M.start_method == "Inherited (took over team)").sum()), by_start=M.start_method.value_counts().to_dict(),
                   by_end=M.end_method.value_counts().to_dict(), current=int((M.end_method == "Still rostered").sum()),
                   per_league=M.groupby("league").agg(stints=("player_id", "size"), players=("player_id", "nunique")).reset_index().to_dict("records"))
pl = M.groupby("player_id").agg(stints=("league", "size"), leagues=("league", "nunique"), days=("days", "sum"),
                                traded_for=("start_method", lambda s: (s == "Trade").sum()), traded_away=("end_method", lambda s: (s == "Traded away").sum()),
                                dropped=("end_method", lambda s: (s == "Dropped").sum()), waiver_adds=("start_method", lambda s: s.isin(["Waiver claim", "Free-agent add"]).sum()),
                                drafted=("start_method", lambda s: s.isin(["Rookie draft", "Startup draft"]).sum()), current=("end_method", lambda s: (s == "Still rostered").sum()))
pl["name"] = pl.index.map(PH.name); pl["pos"] = pl.index.map(PH.pos); pl["school"] = pl.index.map(PH.school); pl["capital"] = pl.index.map(PH.capital)
pl["conf_tier"] = pl.index.map(PH.conf_tier)
Z["n_multi_stint"] = int((pl.stints >= 2).sum()); Z["n_multi_league_ever"] = int((pl.leagues >= 2).sum())
Z["stint_dist"] = pl.stints.value_counts().sort_index().to_dict(); Z["league_dist"] = pl.leagues.value_counts().sort_index().to_dict()
Z["most_stints"] = pl.sort_values(["stints", "leagues", "days"], ascending=False).head(20).reset_index().to_dict("records")
Z["most_days"] = pl.sort_values("days", ascending=False).head(15).reset_index().to_dict("records")
Z["most_traded_for"] = pl[pl.traded_for > 0].sort_values(["traded_for", "stints"], ascending=False).head(15).reset_index().to_dict("records")
Z["most_traded_away"] = pl[pl.traded_away > 0].sort_values(["traded_away", "stints"], ascending=False).head(15).reset_index().to_dict("records")
Z["most_dropped"] = pl[pl.dropped > 0].sort_values(["dropped", "waiver_adds"], ascending=False).head(12).reset_index().to_dict("records")
pl.to_csv(os.path.join(OUT, "brett_every_player_owned.csv"))
# multi-stint profile vs single-stint (school / draft capital)
pl["multi"] = pl.stints >= 2
Z["multi_profile"] = dict(capital=pd.crosstab(pl.capital, pl.multi, normalize="columns").round(3).to_dict(), tier=pd.crosstab(pl.conf_tier, pl.multi, normalize="columns").round(3).to_dict(),
                          pos=pd.crosstab(pl.pos, pl.multi, normalize="columns").round(3).to_dict(), n=pl.multi.value_counts().to_dict())
Z["multi_schools"] = pl[pl.multi].school.value_counts().head(10).to_dict()

# ---------------- 2. repeat acquisitions within a league (boomerangs), me vs league-mates ----------------
A = Sx[Sx.acq].sort_values("start").copy()
A["prior_same_mgr"] = A.groupby(["league", "owner", "player_id"]).cumcount() > 0
rep = A.groupby(["league", "owner"]).agg(acqs=("player_id", "size"), repeats=("prior_same_mgr", "sum"))
rep["rate"] = rep.repeats / rep.acqs; rep["me"] = rep.index.get_level_values(1) == ME
Z["reacquire"] = dict(brett_rate=float(rep[rep.me].repeats.sum() / rep[rep.me].acqs.sum()), lm_rate=float(rep[~rep.me].repeats.sum() / rep[~rep.me].acqs.sum()),
                      brett_repeats=int(rep[rep.me].repeats.sum()), by_league=rep.reset_index().assign(owner=lambda d: d.owner == ME).groupby(["league", "owner"])[["acqs", "repeats"]].sum().reset_index().to_dict("records"))
boom = A[A.me & A.prior_same_mgr].groupby(["league", "player_id"]).size().reset_index(name="times")
boom["name"] = boom.player_id.map(PH.name)
Z["boomerangs"] = boom.sort_values("times", ascending=False).head(20).to_dict("records")

# ---------------- 3. activity per league-season ----------------
act = []
for (l, s), g in Sx.groupby(["league", "start_season"]):
    for o, gg in g.groupby("owner"):
        act.append(dict(league=l, season=s, owner=o, me=o == ME, trades=0, waivers=int((gg.start_method == "Waiver claim").sum()), fa=int((gg.start_method == "Free-agent add").sum())))
ACT = pd.DataFrame(act).set_index(["league", "season", "owner"])
tcount = TSx.groupby(["league", "season", "manager"]).tid.nunique()
for k, v in tcount.items():
    if k in ACT.index: ACT.loc[k, "trades"] = v
drops = Sx[Sx.end_method == "Dropped"].groupby(["league", "end_season", "owner"]).size()
ACT["drops"] = [int(drops.get((l, s, o), 0)) for l, s, o in ACT.index]
ACT = ACT.reset_index()
Z["activity"] = ACT.groupby("me")[["trades", "waivers", "fa", "drops"]].mean().round(2).reset_index().to_dict("records")
Z["activity_by_league"] = ACT.groupby(["league", "me"])[["trades", "waivers", "fa", "drops"]].mean().round(2).reset_index().to_dict("records")
Z["activity_rank"] = []
for (l, s), g in ACT.groupby(["league", "season"]):
    if g.me.any():
        m = g[g.me].iloc[0]; tot = g.trades + g.waivers + g.fa
        Z["activity_rank"].append(dict(league=l, season=int(s), moves=int(m.trades + m.waivers + m.fa), rank=int((tot > (m.trades + m.waivers + m.fa)).sum() + 1), n=len(g)))

# ---------------- 4. trades ----------------
TSx = TSx.assign(me=TSx.manager == ME)
Z["trade_n"] = dict(brett=int(TSx.me.sum()), lm=int((~TSx.me).sum()))
Z["trade_categories"] = pd.crosstab(TSx.category, TSx.me, normalize="columns").round(3).rename(columns={True: "brett", False: "lm"}).reset_index().to_dict("records")
def flat(col, me):
    return [x for lst in TSx[TSx.me == me][col] for x in lst]
ages = {}
for me in (True, False):
    ai, ao = flat("age_in", me), flat("age_out", me)
    ages["brett" if me else "lm"] = dict(age_in_mean=float(np.mean(ai)), age_out_mean=float(np.mean(ao)), age_in_median=float(np.median(ai)), age_out_median=float(np.median(ao)), n_in=len(ai), n_out=len(ao))
ages["p_in"] = float(stats.mannwhitneyu(flat("age_in", True), flat("age_in", False)).pvalue); ages["p_out"] = float(stats.mannwhitneyu(flat("age_out", True), flat("age_out", False)).pvalue)
# value-weighted ages
def vw(me, side):
    rows = []
    for r in TSx[TSx.me == me].itertuples():
        ps = r.players_in if side == "in" else r.players_out
        for p in ps:
            b = PH.birth_date.get(p); fp = PH.fp_id.get(p)
            if pd.notna(b): rows.append(((r.date - b).days / 365.25, 1.0))
    return rows
Z["trade_ages"] = ages
posf = {}
for me in (True, False):
    pi = pd.Series(flat("pos_in", me)).value_counts(); po = pd.Series(flat("pos_out", me)).value_counts()
    posf["brett" if me else "lm"] = dict(pos_in=(pi / pi.sum()).round(3).to_dict(), pos_out=(po / po.sum()).round(3).to_dict(), n_in=int(pi.sum()), n_out=int(po.sum()),
                                         in_counts=pi.to_dict(), out_counts=po.to_dict())
Z["trade_positions"] = posf
# per-trade value balance, then (at the time) and hindsight
TSx["net_then"] = TSx.v_in - TSx.v_out; TSx["net_now"] = TSx.now_in - TSx.now_out; TSx["net_1y"] = TSx.y1_in - TSx.y1_out
TSx["gross_then"] = TSx.v_in + TSx.v_out
def trade_summary(d):
    d = d[d.gross_then > 0]
    old = d[d.net_1y.notna()]
    wr = lambda x: float((x > 0).sum() / max(1, (x != 0).sum()))                  # wins / (wins + losses)
    return dict(n=len(d), mean_net_then=float(d.net_then.mean()), win_then=wr(d.net_then), total_net_then=float(d.net_then.sum()),
                mean_net_now=float(d.net_now.mean()), win_now=wr(d.net_now), total_net_now=float(d.net_now.sum()), wins_now=int((d.net_now > 0).sum()), losses_now=int((d.net_now < 0).sum()),
                n_1y=len(old), win_1y=wr(old.net_1y) if len(old) else None, mean_net_1y=float(old.net_1y.mean()) if len(old) else None,
                pct_then=float(d.net_then.sum() / d.gross_then.sum() * 2))
Z["trade_value"] = dict(brett=trade_summary(TSx[TSx.me]), lm=trade_summary(TSx[~TSx.me]))
TSx["shape"] = np.select([TSx.players_out.str.len() > TSx.players_in.str.len(), TSx.players_out.str.len() < TSx.players_in.str.len()], ["You sent more players", "You got more players"], "Even player count")
Z["trade_value_shape"] = [dict(shape=sh, who="brett" if me else "lm", **trade_summary(d)) for (sh, me), d in TSx.groupby(["shape", "me"])]
# per-manager hindsight win rates (for a percentile)
mg = TSx[TSx.gross_then > 0].groupby(["league", "manager"]).agg(n=("tid", "size"), win_now=("net_now", lambda s: (s > 0).sum() / max(1, (s != 0).sum())), net_now=("net_now", "sum"), net_then=("net_then", "sum"))
mg = mg[mg.n >= 5]; mg["me"] = mg.index.get_level_values(1) == ME
Z["trade_mgr_rank"] = [dict(league=l, n=int(r.n), win_now=float(r.win_now), rank=int((mg.loc[l].win_now > r.win_now).sum() + 1), of=int(len(mg.loc[l])),
                            net_now=float(r.net_now), net_rank=int((mg.loc[l].net_now > r.net_now).sum() + 1)) for (l, m), r in mg[mg.me].iterrows()]
Z["best_trades"] = TSx[TSx.me].sort_values("net_now", ascending=False).head(8)[["league", "date", "players_in", "players_out", "picks_in", "picks_out", "v_in", "v_out", "now_in", "now_out"]].assign(
    players_in=lambda d: d.players_in.map(lambda x: [PH.name.get(p, p) for p in x]), players_out=lambda d: d.players_out.map(lambda x: [PH.name.get(p, p) for p in x]), date=lambda d: d.date.astype(str)).to_dict("records")
Z["worst_trades"] = TSx[TSx.me].sort_values("net_now").head(8)[["league", "date", "players_in", "players_out", "picks_in", "picks_out", "v_in", "v_out", "now_in", "now_out"]].assign(
    players_in=lambda d: d.players_in.map(lambda x: [PH.name.get(p, p) for p in x]), players_out=lambda d: d.players_out.map(lambda x: [PH.name.get(p, p) for p in x]), date=lambda d: d.date.astype(str)).to_dict("records")
# picks in trades
pk = {}
for me in (True, False):
    d = TSx[TSx.me == me]
    ki, ko = pd.Series([int(x.split("R")[1]) for x in flat("picks_in", me)]), pd.Series([int(x.split("R")[1]) for x in flat("picks_out", me)])
    units = ACT[ACT.me == me].shape[0]
    pk["brett" if me else "lm"] = dict(in_per_season=len(ki) / units, out_per_season=len(ko) / units, firsts_in_per_season=int((ki == 1).sum()) / units, firsts_out_per_season=int((ko == 1).sum()) / units,
                                       pick_value_in=float(d.v_in_picks.sum() / units), pick_value_out=float(d.v_out_picks.sum() / units), share_trades_with_picks=float(((d.picks_in.str.len() + d.picks_out.str.len()) > 0).mean()))
Z["trade_picks"] = pk
# consolidation
TSx["n_in"] = TSx.players_in.str.len(); TSx["n_out"] = TSx.players_out.str.len()
Z["consolidation"] = {("brett" if me else "lm"): dict(avg_in=float(d.n_in.mean()), avg_out=float(d.n_out.mean()), share_2for1=float((d.n_out > d.n_in).mean()), share_1for2=float((d.n_in > d.n_out).mean()))
                      for me, d in TSx.groupby("me")}
# partners
part = []
for r in TSx[TSx.me].itertuples():
    for p in r.partners: part.append((r.league, names.get((r.league, p), p)))
pp = pd.Series(part).value_counts()
Z["partners"] = [dict(league=l, team=t, trades=int(n)) for (l, t), n in pp.head(12).items()]
conc = []
for (l, m), g in TSx.groupby(["league", "manager"]):
    ps = pd.Series([p for lst in g.partners for p in lst]).value_counts()
    if len(g) >= 5: conc.append(dict(league=l, me=m == ME, top_share=float(ps.iloc[0] / ps.sum()), distinct=int(len(ps))))
CC = pd.DataFrame(conc)
Z["partner_conc"] = CC.groupby("me")[["top_share", "distinct"]].mean().round(3).reset_index().to_dict("records")
# timing
TSx["month"] = TSx.date.dt.month; TSx["hour_et"] = (TSx.date - pd.Timedelta(hours=4)).dt.hour
Z["trade_months"] = pd.crosstab(TSx.month, TSx.me, normalize="columns").round(3).rename(columns={True: "brett", False: "lm"}).reset_index().to_dict("records")
Z["trade_hours"] = pd.crosstab(pd.cut(TSx.hour_et, [-1, 5, 11, 17, 23], labels=["Midnight–6am", "6am–noon", "Noon–6pm", "6pm–midnight"]), TSx.me, normalize="columns").round(3).rename(columns={True: "brett", False: "lm"}).reset_index().astype({"hour_et": str}).to_dict("records")
# quick flips: acquired by trade and traded away within 60 days
T_in = Sx[(Sx.start_method == "Trade")]
flip = T_in[(T_in.end_method == "Traded away") & (T_in.days <= 60)]
Z["quick_flips"] = dict(brett=float(len(flip[flip.me]) / max(1, len(T_in[T_in.me]))), lm=float(len(flip[~flip.me]) / max(1, len(T_in[~T_in.me]))),
                        brett_n=int(len(flip[flip.me])), examples=list(flip[flip.me].sort_values("days").name.head(10)))
# repeat trade targets
tf = pl[pl.traded_for >= 2]
Z["repeat_trade_targets"] = tf.sort_values("traded_for", ascending=False)[["name", "traded_for", "stints", "leagues"]].reset_index().to_dict("records")
lm_tf = Sx[(Sx.start_method == "Trade") & ~Sx.me].groupby(["league", "owner", "player_id"]).size()
my_tf = Sx[(Sx.start_method == "Trade") & Sx.me].groupby(["league", "owner", "player_id"]).size()
Z["same_player_traded_for_twice_in_league"] = dict(brett=int((my_tf >= 2).sum()), brett_rate=float((my_tf >= 2).sum() / len(my_tf)), lm_rate=float((lm_tf >= 2).sum() / len(lm_tf)))

# ---------------- 5. tenure (Kaplan-Meier; still-rostered = censored) ----------------
def km(d, e):
    d, e = np.asarray(d, float), np.asarray(e, bool)
    order = np.argsort(d); d, e = d[order], e[order]
    n = len(d); s = 1.0; med = None; surv = []
    for t in np.unique(d):
        at = (d >= t).sum(); ev = ((d == t) & e).sum()
        if at > 0: s *= (1 - ev / at)
        surv.append((t, s))
        if med is None and s <= 0.5: med = t
    # restricted mean survival to 730 days
    rm = 0.0; prev_t, prev_s = 0.0, 1.0
    for t, sv in surv:
        if t > 730: break
        rm += prev_s * (t - prev_t); prev_t, prev_s = t, sv
    rm += prev_s * (730 - prev_t)
    return med, rm, s
def tenure_table(col, groups=None, min_n=15):
    rows = []
    B = Sx[Sx.acq]
    for g, d in B.groupby(col):
        if groups and g not in groups: continue
        for me in (True, False):
            dd = d[d.me == me]
            if len(dd) < (8 if me else min_n): continue
            med, rm, _ = km(dd.days, dd.end_method != "Still rostered")
            rows.append(dict(group=g, who="brett" if me else "lm", n=len(dd), median_days=med, rmst_2y=rm, still=float((dd.end_method == "Still rostered").mean())))
    return rows
B = Sx[Sx.acq]
Z["tenure_overall"] = []
for me in (True, False):
    dd = B[B.me == me]; med, rm, _ = km(dd.days, dd.end_method != "Still rostered")
    Z["tenure_overall"].append(dict(who="brett" if me else "lm", n=len(dd), median_days=med, rmst_2y=rm))
Z["tenure_method"] = tenure_table("start_method", ["Startup draft", "Rookie draft", "Trade", "Waiver claim", "Free-agent add"])
Z["tenure_pos"] = tenure_table("pos", ["QB", "RB", "WR", "TE"])
Z["tenure_capital"] = tenure_table("capital", ["R1 top-10", "R1 11-32", "R2", "R3", "R4", "R5", "R6", "R7", "UDFA"])
Z["tenure_tier"] = tenure_table("conf_tier", ["Power", "Group of Five", "FCS", "D-II"])
B = B.assign(age_grp=pd.cut(B.age_start, [0, 23, 25, 27, 29, 50], labels=["≤22", "23–24", "25–26", "27–28", "29+"], right=False))
Sx["age_grp"] = pd.cut(Sx.age_start, [0, 23, 25, 27, 29, 50], labels=["≤22", "23–24", "25–26", "27–28", "29+"], right=False)
Z["tenure_age"] = tenure_table("age_grp", ["≤22", "23–24", "25–26", "27–28", "29+"])
top_sch = B[B.me].school.value_counts().head(8).index.tolist()
Z["tenure_school"] = tenure_table("school", top_sch, min_n=20)
Z["longest_current"] = S[S.is_me & (S.end_method == "Still rostered")].sort_values("days", ascending=False).head(10)[["name", "league", "start", "days", "start_method"]].assign(start=lambda d: d.start.astype(str)).to_dict("records")
Z["longest_ever"] = S[S.is_me].sort_values("days", ascending=False).head(10)[["name", "league", "start", "days", "start_method", "end_method"]].assign(start=lambda d: d.start.astype(str)).to_dict("records")

# ---------------- 6. acquisitions profile vs league-mates ----------------
prof = {}
for col in ["pos", "capital", "conf_tier", "conf", "age_grp", "start_method"]:
    t = pd.crosstab(B[col] if col != "age_grp" else B["age_grp"], B.me, normalize="columns").round(4)
    t.columns = ["lm", "brett"]; prof[col] = t.reset_index().rename(columns={col: "cat", "age_grp": "cat"}).astype({"cat": str}).to_dict("records")
Z["acq_profile"] = prof
Z["acq_age"] = {("brett" if me else "lm"): dict(mean=float(d.age_start.mean()), median=float(d.age_start.median()), n=len(d)) for me, d in B.groupby("me")}
Z["acq_age_by_method"] = B.groupby(["start_method", "me"]).age_start.mean().round(2).unstack().rename(columns={True: "brett", False: "lm"}).reset_index().to_dict("records")
Z["acq_schools"] = B[B.me].school.value_counts().head(12).to_dict()
lm_sch = B[~B.me].school.value_counts(normalize=True)
Z["acq_school_ratio"] = [dict(school=s, brett=int(n), brett_share=float(n / B.me.sum()), lm_share=float(lm_sch.get(s, 0))) for s, n in B[B.me].school.value_counts().head(12).items()]

# ---------------- 7. waivers / free agents: value found ----------------
WA = Sx[Sx.start_method.isin(["Waiver claim", "Free-agent add"])].copy()
WA["full"] = (WA.start + pd.Timedelta(days=365)) <= NOW
WA["was_top150"] = WA.rank_start <= 150
WA["hit_any"] = (WA.rank_best_12m_after_add <= 150) & ~WA.was_top150
WA["hit_kept"] = (WA.rank_best_held <= 150) & ~WA.was_top150
WA["useful"] = WA.starts >= 3
def rate(d, c): return float(d[c].mean()) if len(d) else None
F = WA[WA.full]
Z["waiver"] = {("brett" if me else "lm"): dict(adds=len(d), full_window=int(len(dd)), hit_any=rate(dd, "hit_any"), hit_kept=rate(dd, "hit_kept"), useful=rate(d, "useful"),
                                               pts_per_add=float(d.started_points.mean()), median_days_held=float(d.days.median()),
                                               faab_spent=float(pd.to_numeric(d.start_info.map(lambda x: json.loads(x).get("bid") if isinstance(x, str) else None), errors="coerce").fillna(0).sum()))
               for me, d in WA.groupby("me") for dd in [d[d.full]]}
wl = []
for l, g in F.groupby("league"):
    a, b = g[g.me], g[~g.me]
    if len(a): wl.append(dict(league=l, n_brett=len(a), brett_hit=float(a.hit_any.mean()), lm_hit=float(b.hit_any.mean()), brett_kept=float(a.hit_kept.mean()), lm_kept=float(b.hit_kept.mean())))
Z["waiver_by_league"] = wl
Z["waiver_hits"] = WA[WA.me & (WA.hit_any | WA.hit_kept)].sort_values("rank_best_12m_after_add")[["name", "league", "start", "start_method", "rank_start", "rank_best_12m_after_add", "rank_best_held", "days", "end_method", "started_points"]].assign(start=lambda d: d.start.astype(str)).head(20).to_dict("records")
Z["waiver_points_share"] = None
# claims lost
FCx = inls(FC_)
FCx = FCx.assign(me=FCx.owner == ME)
won = WA[WA.start_method == "Waiver claim"].groupby("me").size()
lost = FCx.groupby("me").size()
Z["claims"] = {("brett" if me else "lm"): dict(won=int(won.get(me, 0)), failed=int(lost.get(me, 0)), win_rate=float(won.get(me, 0) / (won.get(me, 0) + lost.get(me, 0))),
                                               failed_reasons=FCx[FCx.me == me].note.fillna("(none)").str[:60].value_counts().head(4).to_dict()) for me in (True, False)}

# ---------------- 8. drops: cut too soon ----------------
D = Sx[Sx.end_method == "Dropped"].copy()
D["full"] = D.full_year_after_exit.astype(bool)
D["rank_at_drop"] = D.apply(lambda r: r.rank_best_held if False else np.nan, axis=1)
DL_ = D[D.full]
DL_ = DL_.assign(was_top150=DL_.v_end >= 0, regret=(DL_.rank_best_12m_after_exit <= 150))
# rank at drop: recompute from the start/end values is not stored; use v_end rank proxy through value thresholds
D["regret"] = (D.rank_end > 150) & (D.rank_best_12m_after_exit <= 150)
D["regret100"] = (D.rank_end > 100) & (D.rank_best_12m_after_exit <= 100)
D["dropped_top150"] = D.rank_end <= 150
Z["drops"] = {("brett" if me else "lm"): dict(drops=len(d), full=len(dd), regret_rate=float(dd.regret.mean()) if len(dd) else None,
                                              regret_top100=float(dd.regret100.mean()) if len(dd) else None, dropped_top150=float(d.dropped_top150.mean()),
                                              median_days_before_drop=float(d.days.median()))
              for me, d in D.groupby("me") for dd in [d[d.full]]}
dl = []
for l, g in D[D.full].groupby("league"):
    a, b = g[g.me], g[~g.me]
    if len(a): dl.append(dict(league=l, n_brett=len(a), brett=float(a.regret.mean()), lm=float(b.regret.mean())))
Z["drops_by_league"] = dl
Z["drop_regrets"] = D[D.me & D.regret].sort_values("rank_best_12m_after_exit")[["name", "league", "end", "days", "rank_end", "rank_best_12m_after_exit", "rank_now", "start_method"]].assign(end=lambda d: d.end.astype(str)).head(20).to_dict("records")

# ---------------- 9. traded away: sold before breakout / at the top ----------------
TA = Sx[Sx.end_method == "Traded away"].copy()
TA = TA[TA.full_year_after_exit.astype(bool)]
TA["sold_before_breakout"] = (TA.rank_end > 150) & (TA.rank_best_12m_after_exit <= 150)
TA["sold_near_top"] = TA.v_max_12m_after_exit < TA.v_end * 0.8
Z["sold"] = {("brett" if me else "lm"): dict(n=len(d), before_breakout=float(d.sold_before_breakout.mean()), near_top=float(d.sold_near_top.mean())) for me, d in TA.groupby("me")}
Z["sold_before_breakout_list"] = TA[TA.me & TA.sold_before_breakout].sort_values("v_max_12m_after_exit", ascending=False)[["name", "league", "end", "v_end", "v_max_12m_after_exit"]].assign(end=lambda d: d.end.astype(str)).head(12).to_dict("records")
TB = Sx[(Sx.start_method == "Trade")].copy(); TB = TB[(TB.start + pd.Timedelta(days=365)) <= NOW]
TB["bought_before_breakout"] = TB.v_max_12m_after_add > TB.v_start * 2
TB["bought_at_top"] = TB.v_max_12m_after_add <= TB.v_start * 1.0
Z["bought"] = {("brett" if me else "lm"): dict(n=len(d), before_breakout=float(d.bought_before_breakout.mean()), at_top=float(d.bought_at_top.mean())) for me, d in TB.groupby("me")}

# ---------------- 10. rookie draft picks: use vs trade away ----------------
RDx = inls(RD)
own_rows = []
for (l, s), g in RDx.groupby(["league", "season"]):
    owners = {}
    lid = dict((int(a), b) for a, b in chains[l])[s]
    for r in json.load(open(os.path.join(H, lid, "rosters.json"))): owners[r["roster_id"]] = r.get("owner_id")
    for rid, o in owners.items():
        own = g[g.orig_roster == rid]; made = g[g.picker == rid]
        own_rows.append(dict(league=l, season=s, owner=o, me=o == ME, own=len(own), own_used=int((own.picker == rid).sum()), made=len(made), acquired_used=int((made.orig_roster != rid).sum()),
                             firsts_own=int((own["round"] == 1).sum()), firsts_used=int(((own["round"] == 1) & (own.picker == rid)).sum()), firsts_made=int((made["round"] == 1).sum())))
OR = pd.DataFrame(own_rows)
Z["picks_use"] = {("brett" if me else "lm"): dict(drafts=len(d), own_kept_rate=float(d.own_used.sum() / d.own.sum()), made_per_draft=float(d.made.mean()),
                                                   own_per_draft=float(d.own.mean()), acquired_per_draft=float(d.acquired_used.mean()),
                                                   first_kept_rate=float(d.firsts_used.sum() / max(1, d.firsts_own.sum())), firsts_made_per_draft=float(d.firsts_made.mean()))
                  for me, d in OR.groupby("me")}
Z["picks_use_by_draft"] = OR[OR.me].sort_values(["league", "season"])[["league", "season", "own", "own_used", "made", "acquired_used"]].to_dict("records")
pctl = []
for (l, s), g in OR.groupby(["league", "season"]):
    if g.me.any():
        m = g[g.me].iloc[0]; pctl.append(dict(league=l, season=int(s), made=int(m.made), rank=int((g.made > m.made).sum() + 1), n=len(g)))
Z["picks_made_rank"] = pctl
# outcomes of rookie picks: value now vs players taken within +/-3 picks in the same draft
RDx = RDx.assign(me=[(l, s) in mine_ls and o == ME for l, s, o in zip(RDx.league, RDx.season, RDx.picker.map(lambda r: None))])
rk_rows = []
for (l, s), g in RDx.groupby(["league", "season"]):
    lid = dict((int(a), b) for a, b in chains[l])[s]
    owners = {r["roster_id"]: r.get("owner_id") for r in json.load(open(os.path.join(H, lid, "rosters.json")))}
    sf = FMT[l]["sf"]
    for r in g.itertuples():
        fp = PH.fp_id.get(r.player_id)
        sub = S[(S.league == l) & (S.player_id == r.player_id)]
        vnow = float(sub.v_now.iloc[0]) if len(sub) else 0.0
        rk_rows.append(dict(league=l, season=s, pick_no=r.pick_no, round=r.round, owner=owners.get(r.picker), player_id=r.player_id, v_now=vnow,
                            rank_now=float(sub.rank_now.iloc[0]) if len(sub) else 9999.0, best_rank=float(sub.rank_best_held.min()) if len(sub) else 9999.0))
RK = pd.DataFrame(rk_rows)
RK["me"] = RK.owner == ME
RK["neigh"] = [RK[(RK.league == r.league) & (RK.season == r.season) & (abs(RK.pick_no - r.pick_no) <= 3)].v_now.mean() for r in RK.itertuples()]
RK["vos"] = RK.v_now - RK.neigh
Z["rookie_outcomes"] = {("brett" if me else "lm"): dict(n=len(d), hit150=float((d.best_rank <= 150).mean()), mean_vos=float(d.vos.mean()), median_vos=float(d.vos.median()),
                                                         share_beat_neighbours=float((d.vos > 0).mean())) for me, d in RK[RK.season <= 2025].groupby("me")}
Z["rookie_vos_p"] = float(stats.mannwhitneyu(RK[(RK.season <= 2025) & RK.me].vos, RK[(RK.season <= 2025) & ~RK.me].vos).pvalue)
myrk = RK[RK.me].assign(name=lambda d: d.player_id.map(PH.name))
Z["my_rookie_picks"] = myrk.sort_values("v_now", ascending=False)[["name", "league", "season", "round", "pick_no", "v_now", "rank_now", "vos"]].to_dict("records")
# what happened to my rookie picks
mine_rook = S[S.is_me & (S.start_method == "Rookie draft")]
Z["rookie_fate"] = mine_rook.end_method.value_counts().to_dict()
lm_rook = Sx[~Sx.me & (Sx.start_method == "Rookie draft")]
Z["rookie_fate_lm"] = (lm_rook.end_method.value_counts(normalize=True)).round(3).to_dict()
Z["rookie_fate_share"] = (mine_rook.end_method.value_counts(normalize=True)).round(3).to_dict()

# ---------------- 11. positions rostered over time (weekly) ----------------
Wx = Wx.assign(pos=Wx.player_id.map(PH.pos))
pc = Wx.groupby(["league", "season", "week", "roster_id", "owner", "pos"]).size().unstack(fill_value=0).reset_index()
pc["me"] = pc.owner == ME
Z["pos_weekly"] = pc.groupby(["league", "me"])[["QB", "RB", "WR", "TE"]].mean().round(2).reset_index().to_dict("records")
Z["pos_weekly_all"] = pc.groupby("me")[["QB", "RB", "WR", "TE"]].mean().round(2).reset_index().to_dict("records")
pw = []
for (l, s), g in pc.groupby(["league", "season"]):
    rr = g.groupby(["roster_id", "me"])[["QB", "RB", "WR", "TE"]].mean().reset_index()
    if rr.me.any():
        m = rr[rr.me].iloc[0]
        pw.append(dict(league=l, season=int(s), **{p: float(m[p]) for p in ["QB", "RB", "WR", "TE"]}, **{f"{p}_rank": int((rr[p] > m[p]).sum() + 1) for p in ["QB", "RB", "WR", "TE"]}, n=len(rr)))
Z["pos_weekly_rank"] = pw
# points by acquisition channel
Wp = Wx[Wx.started].copy()
key = Sx[["league", "roster_id", "player_id", "start", "end", "start_method"]].copy(); key["end"] = key.end.fillna(NOW)
mp = Wp.merge(key, on=["league", "roster_id", "player_id"], how="left")
mp = mp[(mp.date >= mp.start) & (mp.date <= mp.end)]
mp["me"] = mp.owner == ME
g_ = mp.groupby(["me", "start_method"]).points.sum()
Z["points_by_channel"] = (g_ / g_.groupby(level=0).transform("sum")).round(3).unstack().fillna(0).reset_index().to_dict("records")

# ---------------- 12. never owned (current top 300) ----------------
fc = {}
for k in ["bois", "nowl", "awesome", "brokeback", "bigshow", "maxxing"]:
    for x in json.load(open(os.path.join(RAW, "market", f"fc_{k}.json"))):
        sid = x["player"].get("sleeperId")
        if sid: fc.setdefault(sid, dict(name=x["player"]["name"], pos=x["player"]["position"], vals=[]))["vals"].append(x["value"])
U = pd.DataFrame([dict(sid=k, name=v["name"], pos=v["pos"], val=np.sum(v["vals"]) / 6) for k, v in fc.items() if v["pos"] != "PICK"]).sort_values("val", ascending=False).reset_index(drop=True)
U["rank"] = np.arange(1, len(U) + 1)
top = U[U["rank"] <= 300].copy()
ever = set(S[S.is_me].player_id)
top["ever"] = top.sid.isin(ever)
ever_lm = S[~S.is_me].groupby("player_id").owner.nunique()
top["lm_owners"] = top.sid.map(ever_lm).fillna(0).astype(int)
Z["never"] = dict(top300_never=int((~top.ever).sum()), top100_never=int((~top[top["rank"] <= 100].ever).sum()), top50_never=int((~top[top["rank"] <= 50].ever).sum()),
                  by_pos=top.groupby("pos").ever.agg(lambda s: int((~s).sum())).to_dict(), by_pos_total=top.groupby("pos").size().to_dict(),
                  top50_list=top[(~top.ever) & (top["rank"] <= 60)][["name", "pos", "rank", "lm_owners"]].to_dict("records"),
                  ever_share_by_band={b: float(top[(top["rank"] > lo) & (top["rank"] <= hi)].ever.mean()) for b, lo, hi in [("1–50", 0, 50), ("51–100", 50, 100), ("101–200", 100, 200), ("201–300", 200, 300)]})
# how many rostered-anywhere players never owned
allp = set(S.player_id); Z["never_all"] = dict(players_in_history=len(allp), ever_owned=len(ever), never_owned=len(allp - ever))
# lm comparison: share of current top-300 each manager has ever owned (their leagues only)
cov = []
for (l, o), g in Sx.groupby(["league", "owner"]):
    cov.append(dict(league=l, me=o == ME, share=float(top.sid.isin(set(g.player_id)).mean())))
CV = pd.DataFrame(cov)
Z["top300_coverage_by_league"] = CV.groupby(["league", "me"]).share.mean().round(3).reset_index().to_dict("records")
Z["top300_brett_all_leagues"] = float(top.ever.mean())

json.dump(Z, open(os.path.join(OUT, "analysis_hist.json"), "w"), default=lambda o: None if (isinstance(o, float) and np.isnan(o)) else (o.item() if hasattr(o, "item") else str(o)))
pd.set_option("display.width", 250)
for k in ["totals", "n_multi_stint", "n_multi_league_ever", "stint_dist", "league_dist", "reacquire", "activity", "trade_n", "trade_ages", "trade_value", "trade_mgr_rank", "trade_picks",
          "consolidation", "partner_conc", "quick_flips", "same_player_traded_for_twice_in_league", "tenure_overall", "acq_age", "waiver", "waiver_by_league", "claims", "drops",
          "drops_by_league", "sold", "bought", "picks_use", "rookie_outcomes", "rookie_vos_p", "rookie_fate_share", "rookie_fate_lm", "pos_weekly_all", "never", "never_all",
          "top300_brett_all_leagues", "top300_coverage_by_league", "points_by_channel"]:
    print(f"\n## {k}:", json.dumps(Z[k], default=str)[:1500])

# ---------------- extras for the report ----------------
def km_curve(d, e, grid):
    d, e = np.asarray(d, float), np.asarray(e, bool); out = []
    for g in grid:
        s = 1.0
        for t in np.unique(d[(d <= g) & e]):
            at = (d >= t).sum(); ev = ((d == t) & e).sum(); s *= (1 - ev / at)
        out.append(s)
    return out
grid = [0, 7, 14, 30, 45, 60, 90, 120, 150, 180, 240, 300, 365, 450, 545, 640, 730]
Bk = Sx[Sx.acq]
Z["km_curve"] = dict(grid=grid, brett=km_curve(Bk[Bk.me].days, Bk[Bk.me].end_method != "Still rostered", grid),
                     lm=km_curve(Bk[~Bk.me].days, Bk[~Bk.me].end_method != "Still rostered", grid))
for grp, key in [("Rookie draft", "km_rookie"), ("Trade", "km_trade")]:
    b = Bk[Bk.start_method == grp]
    Z[key] = dict(grid=grid, brett=km_curve(b[b.me].days, b[b.me].end_method != "Still rostered", grid), lm=km_curve(b[~b.me].days, b[~b.me].end_method != "Still rostered", grid))
Z["lm_max_traded_for_same_player"] = int(lm_tf.max()); Z["brett_max_traded_for_same_player_league"] = int(my_tf.max())
Z["distinct_traded_for_per_season"] = dict(brett=float(Sx[Sx.me & (Sx.start_method == "Trade")].player_id.nunique() / ACT[ACT.me].shape[0]),
                                           lm=float(Sx[~Sx.me & (Sx.start_method == "Trade")].groupby(["league", "owner"]).player_id.nunique().sum() / ACT[~ACT.me].shape[0]))
json.dump(Z, open(os.path.join(OUT, "analysis_hist.json"), "w"), default=lambda o: None if (isinstance(o, float) and np.isnan(o)) else (o.item() if hasattr(o, "item") else str(o)))
print("KM:", [round(x, 2) for x in Z["km_curve"]["brett"]], [round(x, 2) for x in Z["km_curve"]["lm"]])
print("max traded for same player in one league: brett", Z["brett_max_traded_for_same_player_league"], "lm", Z["lm_max_traded_for_same_player"], Z["distinct_traded_for_per_season"])
