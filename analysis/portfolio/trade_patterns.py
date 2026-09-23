"""Trade timing, archetypes and what wins trades. Months are New York time. A side's result is judged in context (the Trade Ledger's
ctx_net: value today, plus the next-12-month lineup-point result for a contending team, half of it for a middle team, none for a
rebuilding one); the league-wide 'formula' comparisons also report the pure value-today result. Even = no result either way."""
import json, os
import numpy as np, pandas as pd
import statsmodels.api as sm
from scipy import stats
from common import *

S = pd.read_parquet(os.path.join(OUT, "trade_features.parquet"))
A = pd.read_parquet(os.path.join(OUT, "trade_assets.parquet"))
TR = json.load(open(os.path.join(OUT, "analysis_trades.json")))
rng = np.random.default_rng(7)
R = {}
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
PHASES = {1: "Jan–Feb", 2: "Jan–Feb", 3: "Mar–Apr", 4: "Mar–Apr", 5: "May–Jun", 6: "May–Jun", 7: "Jul–Aug", 8: "Jul–Aug", 9: "Sep–Oct", 10: "Sep–Oct", 11: "Nov–Dec", 12: "Nov–Dec"}
PHASE_NAMES = {"Jan–Feb": "Offseason begins", "Mar–Apr": "NFL free agency and draft", "May–Jun": "Rookie drafts", "Jul–Aug": "Camps and preseason",
               "Sep–Oct": "Early season", "Nov–Dec": "Trade deadline and playoffs"}
S["phase"] = S.month.map(PHASES)
S["decisive"] = S.ctx_net != 0
S["won"] = S.ctx_net > 0; S["lost"] = S.ctx_net < 0
S["clear_win"] = S.ctx_net >= 1500; S["clear_loss"] = S.ctx_net <= -1500                  # big trades either way
S["won_1y"] = np.where(S.net_1y.notna() & (S.net_1y != 0), (S.net_1y > 0).astype(float), np.nan)
S["gross_then"] = S.v_in + S.v_out

def wilson(k, n, z=1.96):
    if n == 0: return (np.nan, np.nan)
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (float(c - h), float(c + h))
def record(d):
    dd = d[d.decisive]; k, n = int(dd.won.sum()), len(dd)
    o = dd[pd.notna(dd.won_1y)]
    lo, hi = wilson(k, n)
    g, l_ = d.ctx_net[d.ctx_net > 0].sum(), -d.ctx_net[d.ctx_net < 0].sum()
    return dict(trades=len(d), wins=k, losses=int(dd.lost.sum()), even=int((~d.decisive).sum()), win_rate=k / n if n else np.nan, ci_lo=lo, ci_hi=hi,
                big_wins=int(d.clear_win.sum()), big_losses=int(d.clear_loss.sum()), vw_share=float(g / (g + l_)) if g + l_ else np.nan,
                net_ctx=float(d.ctx_net.sum()), mean_ctx=float(d.ctx_net.mean()) if len(d) else np.nan, net_now=float(d.net_now.sum()),
                wins_value=int((d.net_now > 0).sum()), losses_value=int((d.net_now < 0).sum()), net_then=float(d.net_then.sum()), aging=float(d.delta.sum()),
                n_1y=len(o), win_1y=float(o.won_1y.mean()) if len(o) else np.nan, pts_net=float(d.pts_net.sum()))

B = S[S.is_me]; L = S[~S.is_me]
BB = B[B.league == "Dynasty Bois"]

# ================= 1. timing =================
def by(d, col, order):
    return [dict(key=k, **record(d[d[col] == k])) for k in order if (d[col] == k).any()]
R["brett_month"] = by(B.assign(mname=B.month.map(lambda m: MONTHS[m - 1])), "mname", MONTHS)
R["brett_phase"] = by(B, "phase", list(PHASE_NAMES))
R["bois_month"] = by(BB.assign(mname=BB.month.map(lambda m: MONTHS[m - 1])), "mname", MONTHS)
R["bois_phase"] = by(BB, "phase", list(PHASE_NAMES))
R["brett_all"] = record(B); R["bois_all"] = record(BB)
R["phase_names"] = PHASE_NAMES
# is the spread between Brett's best and worst month bigger than chance? (shuffle month labels among his decisive trades)
def spread(labels, won, min_n=8):
    df = pd.DataFrame(dict(m=labels, w=won)); g = df.groupby("m").w.agg(["mean", "size"]); g = g[g["size"] >= min_n]
    return g["mean"].max() - g["mean"].min()
def month_test(d, min_n=8, n_perm=10000):
    dd = d[d.decisive]
    obs = spread(dd.month.values, dd.won.values.astype(float), min_n)
    sims = np.array([spread(rng.permutation(dd.month.values), dd.won.values.astype(float), min_n) for _ in range(n_perm)])
    ph = pd.crosstab(dd.phase, dd.won)
    chi = stats.chi2_contingency(ph)
    return dict(spread=float(obs), p_month_spread=float((sims >= obs - 1e-12).mean()), chi2_phase_p=float(chi[1]), min_n=min_n)
R["brett_month_test"] = month_test(B)
R["bois_month_test"] = month_test(BB, min_n=6)
# league-wide calendar: volume, how lopsided, whether the trade-day favourite held, and where good and bad traders make/lose value
two = S[S.n_sides == 2]
T1 = two.sort_values("net_now", ascending=False).groupby("tid").head(1)     # winner's row per trade
cal = []
for m in range(1, 13):
    d = T1[T1.month == m]; s = S[S.month == m]
    fav = s[(s.net_then >= 300)]
    cal.append(dict(month=MONTHS[m - 1], trades=int(d.tid.nunique()), share=float(d.tid.nunique() / T1.tid.nunique()), median_swing=float(d.net_now.median()),
                    mean_swing=float(d.net_now.mean()), fav_held=float((fav.net_now > 0).mean()) if len(fav) else np.nan, fav_n=len(fav)))
R["calendar"] = cal
tq = pd.DataFrame(TR["traders_all"]); tq = tq[tq.qualified]
top = set(tq.nsmallest(max(1, len(tq) // 4), "rank").manager); bot = set(tq.nlargest(max(1, len(tq) // 4), "rank").manager)
R["skill_calendar"] = [dict(month=MONTHS[m - 1], top_net=float(S[(S.month == m) & S.manager.isin(top)].net_now.sum()), top_n=int(((S.month == m) & S.manager.isin(top)).sum()),
                            bottom_net=float(S[(S.month == m) & S.manager.isin(bot)].net_now.sum()), bottom_n=int(((S.month == m) & S.manager.isin(bot)).sum())) for m in range(1, 13)]
R["skill_groups"] = dict(top=sorted(tq[tq.manager.isin(top)].name), bottom=sorted(tq[tq.manager.isin(bot)].name))
# asset market calendar: how much of the price paid an asset keeps one year later, by month bought (median ratio)
A = A.merge(S[["tid", "month"]].drop_duplicates("tid"), on="tid", how="left")
A["cls"] = np.select([A.kind == "pick", A.rookie, A.age <= 24, A.past_cliff], ["Draft pick", "Rookie", "Young (≤24)", "Past age cliff"], "Prime")
A1 = A[A.v_1y.notna() & (A.v_then >= 300)].copy()
A1["keep"] = A1.v_1y / A1.v_then
mk = A1.groupby(["cls", A1.month.map(PHASES)]).keep.agg(["median", "size"]).reset_index().rename(columns={"month": "phase"})
R["asset_calendar"] = mk.to_dict("records")
R["asset_overall"] = A1.groupby("cls").keep.agg(["median", "size"]).reset_index().to_dict("records")

# ================= 2. what wins: oriented side-vs-side comparisons (two-team trades) =================
loo = {}
for m, g in S.groupby("manager"):
    tot, n = g.net_now.sum(), len(g)
    for tid, v in zip(g.tid, g.net_now):
        loo[(m, tid)] = ((tot - v) / (n - 1)) if n >= 6 else np.nan
S["loo_skill"] = [loo.get((m, t), np.nan) for m, t in zip(S.manager, S.tid)]
two = S[S.n_sides == 2].copy()
P = two.merge(two, on="tid", suffixes=("", "_o"))
P = P[P.roster_id != P.roster_id_o].copy()                 # each trade appears twice, once from each side
P["fair_day"] = P.net_then.abs() <= 0.2 * P[["v_in", "v_out"]].max(axis=1)
feat = {
    "Got the best single asset in the deal": P.in_best > P.out_best,
    "Got fewer pieces (consolidated)": P.in_n < P.out_n,
    "Got more value on the day (market favourite)": P.net_then > 0,
    "Got the younger package (1+ yr younger, picks count as 21.5)": P.in_age_blend <= P.out_age_blend - 1,
    "Got the younger players (players only, 1+ yr)": P.in_age <= P.out_age - 1,
    "Got the draft-pick-heavy side (+25 pts of value share)": P.in_pick_share.fillna(0) >= P.out_pick_share.fillna(0) + 0.25,
    "Got the rookie-heavy side (+25 pts)": P.in_rookie_share.fillna(0) >= P.out_rookie_share.fillna(0) + 0.25,
    "Got the veteran side (past-cliff value +25 pts)": P.in_cliff_share.fillna(0) >= P.out_cliff_share.fillna(0) + 0.25,
    "Got the proven-starter side (last-season starters +25 pts)": P.in_starter_share.fillna(0) >= P.out_starter_share.fillna(0) + 0.25,
    "Got the RB-heavy side (+25 pts)": P.in_RB_share.fillna(0) >= P.out_RB_share.fillna(0) + 0.25,
    "Got the WR-heavy side (+25 pts)": P.in_WR_share.fillna(0) >= P.out_WR_share.fillna(0) + 0.25,
    "Got the QB-heavy side (+25 pts)": P.in_QB_share.fillna(0) >= P.out_QB_share.fillna(0) + 0.25,
    "Got the TE-heavy side (+25 pts)": P.in_TE_share.fillna(0) >= P.out_TE_share.fillna(0) + 0.25,
    "Got the risers (value up 15+ pts more over prior 3 months)": P.in_momentum >= P.out_momentum + 0.15,
    "Got the more athletic players (+15 percentile pts)": P.in_ath >= P.out_ath + 0.15,
    "Got more NFL first-round pedigree (+25 pts)": P.in_r1_share.fillna(0) >= P.out_r1_share.fillna(0) + 0.25,
    "Was the stronger roster at the time (contender side)": P.roster_pct <= P.roster_pct_o - 0.33,
    "Better trader in their other trades": P.loo_skill > P.loo_skill_o,
    "Got a player coming off a career year (headline)": (P.head_career_year == True) & (P.head_career_year_o != True),
    "Got a player coming off missed time (headline)": (P.head_missed == True) & (P.head_missed_o != True),
    "Got an in-season hot start (headline)": (P.head_hot == True) & (P.head_hot_o != True),
}
shapes = {
    "Sent 2 pieces, got 1 back": (P.out_n == 2) & (P.in_n == 1),
    "Sent 3+ pieces, got 1 back": (P.out_n >= 3) & (P.in_n == 1),
    "Sent 1 piece, got 2+ back": (P.out_n == 1) & (P.in_n >= 2),
    "Sent 2+ younger pieces for 1 older player (2+ yrs)": (P.out_n >= 2) & (P.in_n == 1) & (P.in_players == 1) & (P.in_age_blend >= P.out_age_blend + 2),
    "Sent 1 older player for 2+ younger pieces (2+ yrs)": (P.in_n >= 2) & (P.out_n == 1) & (P.out_players == 1) & (P.out_age_blend >= P.in_age_blend + 2),
    "Sold players for picks only": P.category == "Sold players for picks",
    "Bought players with picks only": P.category == "Bought players with picks",
    "Straight 1-for-1 player swap, got the younger one": (P.in_n == 1) & (P.out_n == 1) & (P.in_players == 1) & (P.out_players == 1) & (P.in_age <= P.out_age - 1),
    "Straight 1-for-1 player swap, got the older one": (P.in_n == 1) & (P.out_n == 1) & (P.in_players == 1) & (P.out_players == 1) & (P.in_age >= P.out_age + 1),
    "Traded an RB for a WR of similar value (±25%)": (P.in_n <= 2) & (P.out_n <= 2) & (P.in_WR_share >= 0.6) & (P.out_RB_share >= 0.6) & (P.in_v.between(0.75 * P.out_v, 1.33 * P.out_v)),
    "Traded a WR for an RB of similar value (±25%)": (P.in_n <= 2) & (P.out_n <= 2) & (P.in_RB_share >= 0.6) & (P.out_WR_share >= 0.6) & (P.in_v.between(0.75 * P.out_v, 1.33 * P.out_v)),
}
def oriented(mask, d=P):
    s = d[mask.reindex(d.index, fill_value=False)]
    dec = s[s.net_now != 0]; k, n = int((dec.net_now > 0).sum()), len(dec)
    o = s[s.net_1y.notna() & (s.net_1y != 0)]
    pt = s[(s.pts_got + s.pts_partner) > 0]
    fd = dec[dec.fair_day]
    lo, hi = wilson(k, n)
    dc = s[s.ctx_net != 0]
    return dict(n=n, win=k / n if n else np.nan, ci_lo=lo, ci_hi=hi, mean_net=float(s.net_now.mean()) if len(s) else np.nan,
                win_ctx=float((dc.ctx_net > 0).mean()) if len(dc) else np.nan,
                n_1y=len(o), win_1y=float((o.net_1y > 0).mean()) if len(o) else np.nan,
                n_pts=len(pt), win_pts=float((pt.pts_got > pt.pts_partner).mean()) if len(pt) else np.nan,
                n_fair=len(fd), win_fair=float((fd.net_now > 0).mean()) if len(fd) else np.nan,
                p=float(stats.binomtest(k, n, 0.5).pvalue) if n else np.nan)
R["formula"] = [dict(feature=f, **oriented(m)) for f, m in feat.items()]
R["shapes"] = [dict(feature=f, **oriented(m)) for f, m in shapes.items()]
BOIS = P.league == "Dynasty Bois"
R["formula_bois"] = [dict(feature=f, **oriented(m & BOIS)) for f, m in {**feat, **shapes}.items()]
# the same comparisons split by phase (league-wide), for the heat map
key_feats = ["Got the best single asset in the deal", "Got fewer pieces (consolidated)", "Got the younger package (1+ yr younger, picks count as 21.5)",
             "Got the draft-pick-heavy side (+25 pts of value share)", "Got the veteran side (past-cliff value +25 pts)", "Got the RB-heavy side (+25 pts)",
             "Was the stronger roster at the time (contender side)", "Got more value on the day (market favourite)"]
R["formula_by_phase"] = [dict(feature=f, phase=ph, **oriented(feat[f] & (P.phase == ph))) for f in key_feats for ph in PHASE_NAMES]

# multivariable: P(side A wins) from the differences between the two sides (antisymmetric, no intercept)
Q = P[(P.net_now != 0)].copy()
Q = Q[Q.roster_id < Q.roster_id_o]                            # one row per trade
def sdiff(a, b, fill=0.0): return (Q[a].fillna(fill) - Q[b].fillna(fill))
Z = pd.DataFrame({
    "Value edge on the day (share of the deal)": Q.net_then / Q.gross_then.replace(0, np.nan),
    "Got the best single asset (share of the two best)": (Q.in_best - Q.out_best) / (Q.in_best + Q.out_best).replace(0, np.nan),
    "Fewer pieces received (log)": -(np.log1p(Q.in_n) - np.log1p(Q.out_n)),
    "Younger package (years)": -(Q.in_age_blend.fillna(26) - Q.out_age_blend.fillna(26)),
    "Draft-pick share": sdiff("in_pick_share", "out_pick_share"),
    "Past-age-cliff share": sdiff("in_cliff_share", "out_cliff_share"),
    "RB share": sdiff("in_RB_share", "out_RB_share"),
    "QB share": sdiff("in_QB_share", "out_QB_share"),
    "TE share": sdiff("in_TE_share", "out_TE_share"),
    "Last-season starter share": sdiff("in_starter_share", "out_starter_share"),
    "Value trend of players received (3 mo)": sdiff("in_momentum", "out_momentum").clip(-2, 2),
    "Stronger roster at the time": -(Q.roster_pct - Q.roster_pct_o),
}).fillna(0)
y = (Q.net_now > 0).astype(int)
Zs = (Z - 0) / Z.std()                                          # scale only: centring would break the antisymmetry
def fit(y, Zs):
    m = sm.GLM(y, Zs, family=sm.families.Binomial()).fit()
    ci = m.conf_int()
    return [dict(feature=c, odds=float(np.exp(m.params[c])), lo=float(np.exp(ci.loc[c, 0])), hi=float(np.exp(ci.loc[c, 1])), z=float(m.tvalues[c]), p=float(m.pvalues[c])) for c in Zs.columns]
R["model_now"] = fit(y, Zs)
R["model_now_n"] = int(len(y))
m1 = Q.net_1y.notna() & (Q.net_1y != 0)
R["model_1y"] = fit((Q.net_1y[m1] > 0).astype(int), Zs[m1]); R["model_1y_n"] = int(m1.sum())
# without the trade-day value edge: what predicts winning among what the market already priced?
R["model_now_no_value"] = fit(y, Zs.drop(columns=["Value edge on the day (share of the deal)"]))

# ================= 3. Brett's archetypes: what he trades for when he wins and when he loses =================
top3 = {(r["league"], r["manager"]) for r in TR["traders_by_league"] if r["rank"] <= 3}
S["partner_top3"] = [any((l, p) in top3 for p in ps) for l, ps in zip(S.league, S.partner_ids)]
S["head_class"] = np.select([S.head_kind.isna(), S.head_kind == "pick", S.head_rookie == True, S.head_age <= 24, S.head_past_cliff == True],
                            ["Nothing of value", "Draft pick", "Rookie", "Young player (≤24)", "Veteran past age cliff"], "Prime-age player")
S["shape3"] = np.select([S.in_n < S.out_n, S.in_n > S.out_n], ["consolidated", "took more pieces"], "even count")
tags = {
    "Headline: draft pick": S.head_kind == "pick",
    "Headline: rookie (first NFL season)": S.head_rookie == True,
    "Headline: player 24 or younger": (S.head_kind == "player") & (S.head_age <= 24),
    "Headline: past his position's age cliff": S.head_past_cliff == True,
    "Headline: QB": S.head_pos == "QB", "Headline: RB": S.head_pos == "RB", "Headline: WR": S.head_pos == "WR", "Headline: TE": S.head_pos == "TE",
    "Headline: last season's starter": S.head_starter == True,
    "Headline: last season's top-6/12 (elite)": S.head_elite == True,
    "Headline: coming off a career year": S.head_career_year == True,
    "Headline: coming off missed time": S.head_missed == True,
    "Headline: in-season hot start": S.head_hot == True,
    "Headline: value up 20%+ in prior 3 months (buy high)": S.head_riser == True,
    "Headline: value down 20%+ in prior 3 months (buy low)": S.head_faller == True,
    "Headline: NFL first-round pick": S.head_r1 == True,
    "Headline: top-quarter athlete": S.head_ath >= 0.75,
    "Consolidated (sent more pieces)": S.in_n < S.out_n,
    "Took on more pieces": S.in_n > S.out_n,
    "Sold players for picks": S.category == "Sold players for picks",
    "Bought players with picks": S.category == "Bought players with picks",
    "Your roster was top third at the time": S.roster_pct <= 0.34,
    "Your roster was bottom third at the time": S.roster_pct >= 0.66,
    "Bold bet (paid 30%+ over the market)": S.consensus.str.startswith("Bold"),
    "Partner was a top-3 trader in that league": S.partner_top3,
    "In season (Sep–Dec)": S.month.isin([9, 10, 11, 12]),
    "Offseason (Jan–Aug)": ~S.month.isin([9, 10, 11, 12]),
}
B = S[S.is_me]; L = S[~S.is_me]; BB = B[B.league == "Dynasty Bois"]; LB = L[L.league == "Dynasty Bois"]
def tag_table(Bd, Ld):
    rows = []
    for t, m in tags.items():
        b, l = Bd[m.reindex(Bd.index, fill_value=False)], Ld[m.reindex(Ld.index, fill_value=False)]
        rb, rl = record(b), record(l)
        rows.append(dict(tag=t, b_n=rb["trades"], b_share=len(b) / len(Bd), b_w=rb["wins"], b_l=rb["losses"], b_win=rb["win_rate"], b_net=rb["net_ctx"], b_value=rb["net_now"],
                         b_pts=rb["pts_net"], b_mean=rb["mean_ctx"], b_then=rb["net_then"], b_aging=rb["aging"], b_win_1y=rb["win_1y"], b_big_w=rb["big_wins"], b_big_l=rb["big_losses"],
                         l_n=rl["trades"], l_share=len(l) / len(Ld), l_win=rl["win_rate"], l_mean=rl["mean_ctx"], l_win_1y=rl["win_1y"]))
    return rows
R["tags"] = tag_table(B, L)
# the same trade types split by the team's situation at the time (contending / middle / rebuilding)
CTX_TAGS = ["Headline: draft pick", "Sold players for picks", "Headline: past his position's age cliff", "Headline: last season's starter", "Took on more pieces",
            "Consolidated (sent more pieces)", "Headline: player 24 or younger", "Bought players with picks"]
def tag_ctx(Bd, Ld):
    rows = []
    for t in CTX_TAGS:
        m = tags[t]
        for c in ["Contending", "Middle", "Rebuilding"]:
            b = Bd[m.reindex(Bd.index, fill_value=False) & (Bd.context == c)]; l = Ld[m.reindex(Ld.index, fill_value=False) & (Ld.context == c)]
            rb, rl = record(b), record(l)
            rows.append(dict(tag=t, context=c, b_n=rb["trades"], b_w=rb["wins"], b_l=rb["losses"], b_win=rb["win_rate"], b_net=rb["net_ctx"], b_value=rb["net_now"], b_pts=rb["pts_net"],
                             l_n=rl["trades"], l_win=rl["win_rate"], l_mean=rl["mean_ctx"]))
    return rows
R["tag_context"] = tag_ctx(B, L)
R["by_context"] = [dict(context=c, b=record(B[B.context == c]), l=record(L[L.context == c])) for c in ["Contending", "Middle", "Rebuilding"]]
R["tags_bois"] = tag_table(BB, LB)
R["tag_context_bois"] = tag_ctx(BB, LB)
R["by_context_bois"] = [dict(context=c, b=record(BB[BB.context == c]), l=record(LB[LB.context == c])) for c in ["Contending", "Middle", "Rebuilding"]]
# mix vs execution: expected win rate from league-mates' win rate in each headline class x shape cell
def decompose(Bd, Ld):
    cell = ["head_class", "shape3"]
    lm = Ld[Ld.decisive].groupby(cell).won.mean()
    bd = Bd[Bd.decisive]
    exp = bd.apply(lambda r: lm.get((r.head_class, r.shape3), np.nan), axis=1)
    return dict(actual=float(bd.won.mean()), expected_from_mix=float(exp.mean()), n=int(len(bd)),
                cells=[dict(head_class=k[0], shape=k[1], b_n=int(len(g)), b_win=float(g.won.mean()), lm_win=float(lm.get(k, np.nan)))
                       for k, g in bd.groupby(cell)])
R["decompose"] = decompose(B, L); R["decompose_bois"] = decompose(BB, LB)
R["head_class"] = [dict(cls=c, b=record(B[B.head_class == c]), l=record(L[L.head_class == c]), b_share=float((B.head_class == c).mean()), l_share=float((L.head_class == c).mean()))
                   for c in ["Draft pick", "Rookie", "Young player (≤24)", "Prime-age player", "Veteran past age cliff", "Nothing of value"]]
R["head_class_bois"] = [dict(cls=c, b=record(BB[BB.head_class == c]), l=record(LB[LB.head_class == c]), b_share=float((BB.head_class == c).mean()), l_share=float((LB.head_class == c).mean()))
                        for c in ["Draft pick", "Rookie", "Young player (≤24)", "Prime-age player", "Veteran past age cliff", "Nothing of value"]]
# profile of what was received: wins vs losses, Brett vs league-mates
prof_cols = {"in_age_blend": "Age of what you got (picks = 21.5)", "out_age_blend": "Age of what you sent", "in_pick_share": "Pick share of value received",
             "in_RB_share": "RB share received", "in_WR_share": "WR share received", "in_QB_share": "QB share received", "in_TE_share": "TE share received",
             "in_starter_share": "Last-season starters, share received", "in_cliff_share": "Past-age-cliff share received", "in_momentum": "3-month value trend of players received",
             "in_ath": "Athletic composite of players received", "in_n": "Pieces received", "out_n": "Pieces sent", "roster_pct": "Your roster rank at the time (0 = best)"}
prof_cols["in_momentum"] = "3-month value trend of players received (median)"
def prof(d): return {c: float(d[c].median() if c == "in_momentum" else d[c].mean()) for c in prof_cols}     # trends are skewed: use the median
R["profile"] = dict(cols=prof_cols, b_win=prof(B[B.won]), b_loss=prof(B[B.lost]), l_win=prof(L[L.won]), l_loss=prof(L[L.lost]),
                    bb_win=prof(BB[BB.won]), bb_loss=prof(BB[BB.lost]), lb_win=prof(LB[LB.won]), lb_loss=prof(LB[LB.lost]))
# Brett's biggest wins / losses with their tags
def tag_list(r): return [t for t, m in tags.items() if m.get(r.name, False)]
def ex(d): return [dict(date=r.date_et.strftime("%Y-%m-%d"), league=r.league, partner=r.partner, got=r.got, gave=r.gave, net_then=float(r.net_then), net_now=float(r.net_now),
                        context=r.context, pts_net=float(r.pts_net), ctx_net=float(r.ctx_net),
                        head=r.head_name if isinstance(r.head_name, str) else "", head_age=None if pd.isna(r.head_age) else float(r.head_age), tags=tag_list(r)) for _, r in d.iterrows()]
R["brett_worst"] = ex(B.nsmallest(12, "ctx_net")); R["brett_best"] = ex(B.nlargest(12, "ctx_net"))
R["bois_worst"] = ex(BB.nsmallest(8, "ctx_net")); R["bois_best"] = ex(BB.nlargest(8, "ctx_net"))

# ================= 4. Dynasty Bois: partners and how the best traders operate =================
pb = []
for r in BB.itertuples():
    for p in r.partner_ids: pb.append((p, r.partner_name, r.net_now, r.net_then, r.ctx_net, r.won, r.lost))
pb = pd.DataFrame(pb, columns=["pid", "name", "net_now", "net_then", "ctx_net", "won", "lost"])
R["bois_partners"] = pb.groupby("pid").agg(name=("name", "last"), trades=("net_now", "size"), wins=("won", "sum"), losses=("lost", "sum"), ctx_net=("ctx_net", "sum"), net_now=("net_now", "sum"),
                                         net_then=("net_then", "sum")).reset_index().sort_values("ctx_net").drop(columns="pid").to_dict("records")
tb = pd.DataFrame(TR["traders_bois"]); tb = tb[tb.qualified].sort_values("rank")
SB = S[S.league == "Dynasty Bois"]
play = []
for r in tb.itertuples():
    d = SB[SB.manager == r.manager]
    seasons = d.year.nunique()
    play.append(dict(name=r.name, rank=int(r.rank), grade=r.grade, trades=len(d), per_year=len(d) / max(1, (d.date_et.max() - d.date_et.min()).days / 365.25), win_rate=float(d[d.decisive].won.mean()),
                     net_ctx=float(d.ctx_net.sum()), net_now=float(d.net_now.sum()), net_then=float(d.net_then.sum()), pts_net=float(d.pts_net.sum()), contending=float((d.context == "Contending").mean()), consolidate=float((d.in_n < d.out_n).mean()), age_in=float(d.in_age_blend.mean()), age_out=float(d.out_age_blend.mean()),
                     pick_in=float(d.in_pick_share.fillna(0).mean()), pick_out=float(d.out_pick_share.fillna(0).mean()), cliff_in=float(d.in_cliff_share.fillna(0).mean()),
                     cliff_out=float(d.out_cliff_share.fillna(0).mean()), in_season=float(d.month.isin([9, 10, 11, 12]).mean()), spring=float(d.month.isin([3, 4, 5, 6]).mean()),
                     best_asset=float((d.in_best > d.out_best).mean()), me=r.manager == ME, titles=r.titles))
R["bois_playbooks"] = play

json.dump(R, open(os.path.join(OUT, "analysis_patterns.json"), "w"), default=lambda o: None if (isinstance(o, float) and np.isnan(o)) else (o.item() if hasattr(o, "item") else str(o)))

pd.set_option("display.width", 250); pd.set_option("display.max_colwidth", 70); pd.set_option("display.max_rows", 200)
print("Brett by month:"); print(pd.DataFrame(R["brett_month"])[["key", "trades", "wins", "losses", "even", "win_rate", "net_now", "net_then", "win_1y", "n_1y"]].round(3).to_string())
print("Brett by phase:"); print(pd.DataFrame(R["brett_phase"])[["key", "trades", "wins", "losses", "win_rate", "ci_lo", "ci_hi", "net_now", "net_then", "win_1y"]].round(3).to_string())
print("month test:", R["brett_month_test"], "| Bois:", R["bois_month_test"])
print("Bois by phase:"); print(pd.DataFrame(R["bois_phase"])[["key", "trades", "wins", "losses", "win_rate", "net_now", "net_then", "win_1y"]].round(3).to_string())
print("calendar:"); print(pd.DataFrame(R["calendar"]).round(3).to_string())
print("skill calendar:"); print(pd.DataFrame(R["skill_calendar"]).round(0).to_string())
print("asset calendar:"); print(pd.DataFrame(R["asset_calendar"]).pivot(index="cls", columns="phase", values="median").round(2).to_string())
print(pd.DataFrame(R["asset_overall"]).round(2).to_string())
print("FORMULA:"); print(pd.DataFrame(R["formula"]).round(3).to_string())
print("SHAPES:"); print(pd.DataFrame(R["shapes"]).round(3).to_string())
print("model now (n=%d):" % R["model_now_n"]); print(pd.DataFrame(R["model_now"]).round(3).to_string())
print("model 1y (n=%d):" % R["model_1y_n"]); print(pd.DataFrame(R["model_1y"]).round(3).to_string())
print("model without value edge:"); print(pd.DataFrame(R["model_now_no_value"]).round(3).to_string())
print("TAGS (Brett vs league-mates):"); print(pd.DataFrame(R["tags"])[["tag", "b_n", "b_share", "b_w", "b_l", "b_win", "b_net", "b_then", "b_win_1y", "l_share", "l_win", "l_win_1y"]].round(3).to_string())
print("decompose:", {k: v for k, v in R["decompose"].items() if k != "cells"}, "| Bois:", {k: v for k, v in R["decompose_bois"].items() if k != "cells"})
print("head class:"); print(pd.DataFrame([dict(cls=r["cls"], b_share=r["b_share"], l_share=r["l_share"], b_n=r["b"]["trades"], b_win=r["b"]["win_rate"], b_net=r["b"]["net_now"], l_win=r["l"]["win_rate"],
                                          b_1y=r["b"]["win_1y"], l_1y=r["l"]["win_1y"]) for r in R["head_class"]]).round(3).to_string())
print("profile:"); print(pd.DataFrame({k: R["profile"][k] for k in ["b_win", "b_loss", "l_win", "l_loss"]}).round(3).to_string())
print("Bois partners:"); print(pd.DataFrame(R["bois_partners"]).round(0).to_string())
print("Bois playbooks:"); print(pd.DataFrame(R["bois_playbooks"]).round(3).to_string())
