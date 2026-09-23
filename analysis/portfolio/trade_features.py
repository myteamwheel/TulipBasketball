"""Per-asset and per-side trade features for every active trade: timing (New York time), what each side received (value then /
one year later / now, age, position, prior-season production, value trend, pedigree, athleticism) and each side's roster strength
at the moment of the trade."""
import json, os, glob
import numpy as np, pandas as pd
from common import *
import values as VAL

FMT = {l: f for l, _, f in LEAGUES}
PH = VAL.PH
ATH = pd.read_parquet(os.path.join(OUT, "athletic.parquet")).set_index("player_id")
X = pd.read_parquet(os.path.join(OUT, "trade_ledger.parquet"))
TS = pd.read_parquet(os.path.join(OUT, "trade_sides.parquet")).set_index(["tid", "roster_id"])
T = pd.read_parquet(os.path.join(OUT, "trades.parquet")).set_index("tid")
ST = pd.read_parquet(os.path.join(OUT, "stints_enriched.parquet"))
NOW = pd.Timestamp(AS_OF_DATE)
STARTER = {"QB": 12, "RB": 24, "WR": 24, "TE": 12}
ELITE = {"QB": 6, "RB": 12, "WR": 12, "TE": 6}
# age at which a position's median 12-month value retention (DynastyProcess, 2020-26, players worth 500+) falls to ~60% or less
AGE_CLIFF = {"QB": 31, "RB": 26, "WR": 27, "TE": 28}
PICK_AGE = 21.5                                                      # a pick counts as a typical incoming rookie in age blends
KICK = {2020: "2020-09-10", 2021: "2021-09-09", 2022: "2022-09-08", 2023: "2023-09-07", 2024: "2024-09-05", 2025: "2025-09-04", 2026: "2026-09-10"}

# ---------------- NFL production ----------------
reg = pd.concat([pd.read_parquet(f, columns=["player_id", "position", "season", "games", "fantasy_points_ppr"])
                 for f in sorted(glob.glob(os.path.join(BRETT_RAW, "stats_player_reg_*.parquet")))], ignore_index=True)
reg = reg[reg.position.isin(["QB", "RB", "WR", "TE"])].copy()
reg["rank"] = reg.groupby(["season", "position"]).fantasy_points_ppr.rank(ascending=False, method="min")
reg["ppg"] = reg.fantasy_points_ppr / reg.games.replace(0, np.nan)
REG = reg.set_index(["player_id", "season"]).sort_index()
best_before = {}                                                     # best PPG (7+ games) in seasons before s
for pid, g in reg[reg.games >= 7].sort_values("season").groupby("player_id"):
    run = -np.inf
    for s, p in zip(g.season, g.ppg):
        best_before[(pid, s)] = run if run > -np.inf else np.nan
        run = max(run, p)
wk = pd.concat([pd.read_parquet(f, columns=["player_id", "position", "season", "week", "season_type", "fantasy_points_ppr"])
                for f in sorted(glob.glob(os.path.join(BRETT_RAW, "stats_player_week_202*.parquet"))) + [os.path.join(RAW, "nflverse", "stats_player_week_2026.parquet")]],
               ignore_index=True)
wk = wk[(wk.season_type == "REG") & wk.position.isin(["QB", "RB", "WR", "TE"])]
wk = wk.drop_duplicates(["player_id", "season", "week"])
WK = {s: g for s, g in wk.groupby("season")}

def weeks_done(ts):
    """completed NFL regular-season weeks at time ts (a week counts once its Monday game is played)"""
    s = ts.year if ts.month >= 9 else ts.year - 1
    k = pd.Timestamp(KICK.get(s, f"{s}-09-08")) + pd.Timedelta(days=5)
    return s, int(np.clip((ts - k).days // 7 + 1, 0, 18)) if ts >= k else 0

_ytd_cache = {}
def season_to_date(season, weeks):
    key = (season, weeks)
    if key not in _ytd_cache:
        g = WK.get(season)
        if g is None or weeks < 3: _ytd_cache[key] = None
        else:
            g = g[g.week <= weeks].groupby(["player_id", "position"]).agg(pts=("fantasy_points_ppr", "sum"), games=("week", "nunique")).reset_index()
            g["ppg"] = g.pts / g.games
            g = g[g.games >= 2]
            g["ppg_rank"] = g.groupby("position").ppg.rank(ascending=False, method="min")
            _ytd_cache[key] = g.set_index("player_id")
    return _ytd_cache[key]

# ---------------- roster strength at each trade ----------------
ST["end_f"] = ST.end.fillna(NOW + pd.Timedelta(days=1))
STL = {l: g[["roster_id", "player_id", "start", "end_f"]].reset_index(drop=True) for l, g in ST.groupby("league")}
def roster_strength(league, t, sf):
    g = STL[league]
    on = g[(g.start < t) & (g.end_f >= t)]
    i = VAL.didx(t)
    if i is None or on.empty: return {}
    M = VAL.V2 if sf else VAL.V1
    vals = on.player_id.map(lambda p: M[i, VAL.fpi[PH.fp_id.get(p)]] if PH.fp_id.get(p) in VAL.fpi else 0.0)
    tot = vals.groupby(on.roster_id).sum()
    rk = tot.rank(ascending=False, method="min")
    n = FMT[league]["teams"]
    return {int(r): dict(roster_value=float(tot[r]), roster_rank=int(rk[r]), roster_pct=float((rk[r] - 1) / max(1, n - 1))) for r in tot.index}

# ---------------- assets ----------------
act = X[X.active]
active_tids = set(act.tid)
A = []
strength = {}
for tid in sorted(active_tids):
    t = T.loc[tid]
    lg = t.league; f = FMT[lg]; sf, n = f["sf"], f["teams"]
    when = pd.to_datetime(t.ts, unit="ms"); later = when + pd.Timedelta(days=365); before = when - pd.Timedelta(days=91)
    et = pd.to_datetime(t.ts, unit="ms", utc=True).tz_convert("America/New_York")
    strength[tid] = roster_strength(lg, when, sf)
    adds, drops, picks = json.loads(t.adds), json.loads(t.drops), json.loads(t.picks)
    cur_season, wdone = weeks_done(when)
    ytd = season_to_date(cur_season, wdone) if et.month in (9, 10, 11, 12) else None
    prior = et.year - 1                                                # last completed regular season
    dd = VAL.rd_date.get((lg, et.year))
    next_draft = (et.year if when < dd else et.year + 1) if dd is not None else (et.year if et.month <= 6 else et.year + 1)
    for p, to in adds.items():
        frm = drops.get(p)
        pos = PH.pos.get(p); bd = PH.birth_date.get(p); gs = PH.gsis_id.get(p)
        rs = PH.rookie_season.get(p); rs = rs if (rs == rs and rs and rs > 1990) else np.nan
        v0 = VAL.player_value(p, when, sf); vb = VAL.player_value(p, before, sf)
        r = dict(tid=tid, league=lg, kind="player", asset_id=p, to=to, frm=frm, pos=pos, name=PH.name.get(p, p),
                 v_then=v0, v_prev=vb, v_now=VAL.player_value(p, NOW, sf), v_1y=VAL.player_value(p, later, sf) if later <= NOW else np.nan,
                 age=(when - bd).days / 365.25 if pd.notna(bd) else np.nan, exp=max(0, et.year - rs) if rs == rs else np.nan,
                 draft_round=PH.draft_round.get(p), capital=PH.capital.get(p), athletic=ATH.athletic.get(p) if p in ATH.index else np.nan)
        if isinstance(gs, str) and (gs, prior) in REG.index:
            s = REG.loc[(gs, prior)]
            if isinstance(s, pd.DataFrame): s = s.iloc[0]
            r.update(prior_pts=float(s.fantasy_points_ppr), prior_games=int(s.games), prior_rank=float(s["rank"]), prior_ppg=float(s.ppg) if s.ppg == s.ppg else np.nan)
        else:
            r.update(prior_pts=0.0, prior_games=0, prior_rank=np.nan, prior_ppg=np.nan)
        r["prior_best_ppg"] = best_before.get((gs, prior), np.nan) if isinstance(gs, str) else np.nan
        if ytd is not None and isinstance(gs, str) and gs in ytd.index:
            r.update(ytd_ppg=float(ytd.loc[gs].ppg), ytd_rank=float(ytd.loc[gs].ppg_rank), ytd_weeks=wdone)
        A.append(r)
    for k in picks:
        s_, rnd, orig = int(k["season"]), int(k["round"]), k["roster_id"]
        v_then, basis_then = VAL.pick_value_at(lg, s_, rnd, orig, when)
        v_now, basis_now = VAL.pick_value_at(lg, s_, rnd, orig, NOW)
        v_1y = VAL.pick_value_at(lg, s_, rnd, orig, later)[0] if later <= NOW else np.nan
        v_drafted, drafted = VAL.pick_drafted_value(lg, s_, rnd, orig, NOW, sf)
        no = VAL.rd_pickno.get((lg, s_, rnd, orig))
        A.append(dict(tid=tid, league=lg, kind="pick", asset_id=f"{s_} R{rnd} (orig {orig})", to=k["owner_id"], frm=k["previous_owner_id"], pos="PICK",
                      name=f"{s_} round {rnd}" + (f" (pick {rnd}.{no - (rnd - 1) * n:02d})" if no else ""), pick_season=s_, pick_round=rnd, pick_orig_roster=orig,
                      pick_slot=f"{rnd}.{no - (rnd - 1) * n:02d}" if no else None, pick_overall=no, pick_years_out=s_ - next_draft,
                      pick_basis_then=basis_then, pick_basis_now=basis_now, pick_player=drafted, pick_player_name=PH.name.get(drafted) if drafted else None,
                      v_now_drafted_player=v_drafted, v_then=v_then, v_now=v_now, v_1y=v_1y, age=np.nan))
A = pd.DataFrame(A)
for c in ["ytd_ppg", "ytd_rank", "ytd_weeks", "pick_season", "pick_round", "pick_orig_roster", "pick_slot", "pick_overall", "pick_years_out", "pick_basis_then",
          "pick_basis_now", "pick_player", "pick_player_name", "v_now_drafted_player"]:
    if c not in A: A[c] = np.nan
A["v_then"] = A.v_then.fillna(0.0)
PM = A.kind == "player"
A["past_cliff"] = PM & (A.age >= A.pos.map(AGE_CLIFF))
A["rookie"] = PM & (A.exp == 0)
A["starter_prior"] = PM & (A.prior_rank <= A.pos.map(STARTER))
A["elite_prior"] = PM & (A.prior_rank <= A.pos.map(ELITE))
A["career_year"] = PM & (A.prior_games >= 7) & A.prior_best_ppg.notna() & (A.prior_ppg >= 1.2 * A.prior_best_ppg) & A.starter_prior
A["missed_time"] = PM & (A.exp >= 1) & (A.prior_games < 10)
A["hot_start"] = PM & A.ytd_rank.notna() & (A.ytd_rank <= A.pos.map(STARTER)) & ~A.starter_prior
A["momentum"] = np.where(PM & (A.v_prev > 0), A.v_then / A.v_prev.where(A.v_prev > 0) - 1, np.nan)
A["riser"] = A.momentum >= 0.2; A["faller"] = A.momentum <= -0.2
A["r1"] = PM & (A.draft_round == 1)
A.to_parquet(os.path.join(OUT, "trade_assets.parquet"))

# ---------------- sides ----------------
def wavg(x, w):
    m = x.notna() & (w > 0)
    return float(np.average(x[m], weights=w[m])) if m.any() else np.nan
def summarize(g, pre):
    """what one side received (pre='in') or sent (pre='out')"""
    pl = g[g.kind == "player"]; pk = g[g.kind == "pick"]
    v = g.v_then.sum()
    d = {f"{pre}_n": len(g), f"{pre}_players": len(pl), f"{pre}_picks": len(pk), f"{pre}_v": v, f"{pre}_best": g.v_then.max() if len(g) else 0.0,
         f"{pre}_pick_share": pk.v_then.sum() / v if v > 0 else np.nan,
         f"{pre}_age": wavg(pl.age, pl.v_then), f"{pre}_age_blend": wavg(pd.concat([pl.age, pd.Series(PICK_AGE, index=pk.index)]), pd.concat([pl.v_then, pk.v_then])),
         f"{pre}_prior_pts": pl.prior_pts.sum(), f"{pre}_momentum": wavg(pl.momentum, pl.v_then), f"{pre}_ath": wavg(pl.athletic, pl.v_then),
         f"{pre}_rookie_share": pl[pl.rookie].v_then.sum() / v if v > 0 else np.nan, f"{pre}_cliff_share": pl[pl.past_cliff].v_then.sum() / v if v > 0 else np.nan,
         f"{pre}_starter_share": pl[pl.starter_prior].v_then.sum() / v if v > 0 else np.nan, f"{pre}_r1_share": pl[pl.r1].v_then.sum() / v if v > 0 else np.nan}
    for pos in ["QB", "RB", "WR", "TE"]:
        d[f"{pre}_{pos}_share"] = pl[pl.pos == pos].v_then.sum() / v if v > 0 else np.nan
    return d
S = []
for r in act.itertuples():
    got = A[(A.tid == r.tid) & (A.to == r.roster_id)]; gave = A[(A.tid == r.tid) & (A.frm == r.roster_id)]
    ts = TS.loc[(r.tid, r.roster_id)]
    et = pd.Timestamp(r.date).tz_localize("UTC").tz_convert("America/New_York")
    d = dict(tid=r.tid, roster_id=r.roster_id, league=r.league, manager=r.manager, manager_name=r.manager_name, team=r.team, partner=r.partner, partner_name=r.partner_name,
             partner_ids=list(r.partner_ids), n_sides=r.n_sides, date_et=et.tz_localize(None), month=et.month, year=et.year, got=r.got, gave=r.gave, category=r.category,
             v_in=r.v_in, v_out=r.v_out, now_in=r.now_in, now_out=r.now_out, net_then=r.net_then, net_now=r.net_now, delta=r.delta,
             y1_in=ts.y1_in, y1_out=ts.y1_out, pts_got=r.pts_got, pts_partner=r.pts_partner, pts_net=r.pts_net, pts_net_all=r.pts_net_all, consensus=r.consensus, grade=r.grade,
             grade_value=r.grade_value, context=r.context, ctx_index=r.ctx_index, standing_pct=r.standing_pct, ctx_net=r.ctx_net, net_2y=r.net_2y, net_3y=r.net_3y, is_me=r.manager == ME)
    d.update(summarize(got, "in")); d.update(summarize(gave, "out"))
    h = got.sort_values("v_then", ascending=False).head(1)
    if len(h) and h.v_then.iloc[0] > 0:
        h = h.iloc[0]
        d.update(head_kind=h.kind, head_pos=h.pos, head_name=h["name"], head_v=h.v_then, head_age=h.age, head_exp=h.exp, head_past_cliff=bool(h.past_cliff),
                 head_rookie=bool(h.rookie), head_starter=bool(h.starter_prior), head_elite=bool(h.elite_prior), head_career_year=bool(h.career_year),
                 head_missed=bool(h.missed_time), head_hot=bool(h.hot_start), head_momentum=h.momentum, head_riser=bool(h.riser), head_faller=bool(h.faller),
                 head_r1=bool(h.r1), head_ath=h.athletic, head_prior_rank=h.prior_rank, head_pick_years_out=h.get("pick_years_out", np.nan))
    s = strength[r.tid].get(r.roster_id, {})
    d.update(roster_value=s.get("roster_value"), roster_rank=s.get("roster_rank"), roster_pct=s.get("roster_pct"))
    S.append(d)
S = pd.DataFrame(S)
S["net_1y"] = S.y1_in - S.y1_out
S["win"] = np.sign(S.net_now)
S.to_parquet(os.path.join(OUT, "trade_features.parquet"))
print("assets:", len(A), "| sides:", len(S), "| Brett sides:", int(S.is_me.sum()))
print("value check (sum of asset values vs ledger):", float((S.in_v - S.v_in).abs().max()), float((S.out_v - S.v_out).abs().max()))
print("coverage: prior stats", f"{A[PM].prior_rank.notna().mean():.1%}", "| momentum", f"{A[PM].momentum.notna().mean():.1%}", "| athletic", f"{A[PM].athletic.notna().mean():.1%}",
      "| roster strength", f"{S.roster_rank.notna().mean():.1%}", "| in-season ytd", int(A.ytd_rank.notna().sum()))
