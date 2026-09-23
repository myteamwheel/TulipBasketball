"""Trade ledger: every trade side valued then / one, two, three years on / now; judged in context (a contending team's lineup points
count alongside value, a rebuilding team is judged on value alone); Brett's trades ranked; league-wide top 50s; trader rankings with
the evidence behind every rank."""
import json, os, glob
import numpy as np, pandas as pd
from scipy import stats
from common import *
import values as VAL

H = os.path.join(RAW, "sleeper", "history")
chains = json.load(open(os.path.join(H, "_chains.json")))
PH = pd.read_parquet(os.path.join(OUT, "players_hist.parquet")).set_index("player_id")
T = pd.read_parquet(os.path.join(OUT, "trades.parquet"))
TS = pd.read_parquet(os.path.join(OUT, "trade_sides.parquet"))
RD = pd.read_parquet(os.path.join(OUT, "rookie_picks.parquet"))
ST = pd.read_parquet(os.path.join(OUT, "stints_enriched.parquet"))
titles = json.load(open(os.path.join(OUT, "titles.json")))
NOW = pd.Timestamp(AS_OF_DATE)

# names
uname, tname = {}, {}
for label, chain in sorted(chains.items()):
    for season, lid in sorted(chain):
        for u in json.load(open(os.path.join(H, lid, "users.json"))):
            uname[u["user_id"]] = u.get("display_name") or u["user_id"]
            tname[(label, int(season), u["user_id"])] = ((u.get("metadata") or {}).get("team_name") or u.get("display_name") or "").strip()
def team(l, s, u, rid=None):
    if u is None: return f"Unowned roster {rid}"
    return tname.get((l, s, u)) or tname.get((l, s - 1, u)) or uname.get(u, "unknown manager")
pname = lambda p: PH.name.get(p, p)
drafted = {(r.league, int(r.season), int(r["round"]), r.orig_roster): (r.player_id, int(r.pick_no)) for _, r in RD.iterrows()}
ORD = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th"}
FMT = {l: f for l, _, f in LEAGUES}
def pick_label(league, k):
    s, rd = int(k["season"]), k["round"]
    p, no = drafted.get((league, s, rd, k["roster_id"]), (None, None))
    lab = f"{s} {ORD.get(rd, str(rd) + 'th')}"
    if no is None: return lab + (" (future)" if s > 2026 else "")
    n = FMT[league]["teams"]; slot = f"{rd}.{no - (rd - 1) * n:02d}"
    return f"{lab} ({slot}, used on {pname(p)})" if p else f"{lab} ({slot})"

# points each side's acquired players started for their new team after the trade: all-time while rostered, and within 12 months
# (the fair comparison -- the same window for both sides, so a manager who later flips a player isn't penalized for it)
ST["tid"] = ST.start_info.map(lambda x: json.loads(x).get("tid") if isinstance(x, str) and x.startswith("{") else None)
tp = ST[ST.start_method == "Trade"].groupby(["tid", "roster_id"]).started_points.sum()
WL_ = pd.read_parquet(os.path.join(OUT, "weekly_lineups.parquet"))
WL_ = WL_[WL_.started].set_index(["league", "roster_id", "player_id"]).sort_index()
p12 = {}
for r in ST[ST.start_method == "Trade"].itertuples():
    key = (r.league, r.roster_id, r.player_id)
    if key not in WL_.index: continue
    w = WL_.loc[[key]]; stop = min(r.end if pd.notna(r.end) else NOW, r.start + pd.Timedelta(days=365))
    p12[(r.tid, r.roster_id)] = p12.get((r.tid, r.roster_id), 0.0) + float(w[(w.date >= r.start) & (w.date <= stop)].points.sum())

rows = []
tmap = T.set_index("tid")
for r in TS.itertuples():
    t = tmap.loc[r.tid]
    picks = json.loads(t.picks)
    got_p = [pname(p) for p in json.loads(r.players_in)]; gave_p = [pname(p) for p in json.loads(r.players_out)]
    got_k = [pick_label(r.league, k) for k in picks if k.get("owner_id") == r.roster_id]
    gave_k = [pick_label(r.league, k) for k in picks if k.get("previous_owner_id") == r.roster_id]
    others = [x for x in json.loads(t.roster_ids) if x != r.roster_id]
    owners = {int(k): v for k, v in json.loads(t.owners).items()}
    rows.append(dict(tid=r.tid, league=r.league, season=int(r.season), date=r.date, roster_id=r.roster_id, manager=r.manager, manager_name=uname.get(r.manager, "(no manager)"),
                     team=team(r.league, int(r.season), r.manager, r.roster_id), partner_ids=[owners.get(o) for o in others],
                     partner=", ".join(team(r.league, int(r.season), owners.get(o), o) for o in others), partner_name=", ".join(uname.get(owners.get(o), "(no manager)") for o in others),
                     got=", ".join(got_p + got_k) + (f" + ${int(r.faab_in)} FAAB" if r.faab_in else ""), gave=", ".join(gave_p + gave_k) + (f" + ${int(r.faab_out)} FAAB" if r.faab_out else ""),
                     n_in=len(got_p), n_out=len(gave_p), v_in=r.v_in, v_out=r.v_out, now_in=r.now_in, now_out=r.now_out,
                     age_in=np.mean(json.loads(r.age_in)) if json.loads(r.age_in) else np.nan, age_out=np.mean(json.loads(r.age_out)) if json.loads(r.age_out) else np.nan,
                     pos_in=json.loads(r.pos_in), pos_out=json.loads(r.pos_out), category=r.category, n_sides=r.n_sides,
                     pts_got_all=float(tp.get((r.tid, r.roster_id), 0.0)), pts_partner_all=float(sum(tp.get((r.tid, o), 0.0) for o in others) / max(1, len(others))),
                     pts_got=float(p12.get((r.tid, r.roster_id), 0.0)), pts_partner=float(sum(p12.get((r.tid, o), 0.0) for o in others) / max(1, len(others)))))
X = pd.DataFrame(rows)
X["net_then"] = X.v_in - X.v_out; X["net_now"] = X.now_in - X.now_out; X["delta"] = X.net_now - X.net_then
X["gross_then"] = X.v_in + X.v_out; X["gross_now"] = X.now_in + X.now_out
X["pts_net"] = X.pts_got - X.pts_partner                                       # 12-month window (used for judging)
X["pts_net_all"] = X.pts_got_all - X.pts_partner_all                           # for as long as each side kept the players
X["shape"] = X.n_out.astype(str) + "-for-" + X.n_in.astype(str)
hz = TS.set_index(["tid", "roster_id"])
for h in (1, 2, 3):
    X[f"net_{h}y"] = [hz.loc[(a, b), f"y{h}_in"] - hz.loc[(a, b), f"y{h}_out"] for a, b in zip(X.tid, X.roster_id)]

# ---------------- context: where each team stood when it traded ----------------
KICK = {2021: "2021-09-09", 2022: "2022-09-08", 2023: "2023-09-07", 2024: "2024-09-05", 2025: "2025-09-04", 2026: "2026-09-10"}
srows = []
for label, chain in chains.items():
    for season, lid in chain:
        L_ = json.load(open(os.path.join(H, lid, "league.json"))); pws = (L_.get("settings") or {}).get("playoff_week_start") or 15
        for f in sorted(glob.glob(os.path.join(H, lid, "matchups_*.json"))):
            wk = int(f[-7:-5])
            if wk >= pws: continue
            by = {}
            for m in json.load(open(f)) or []:
                if m.get("matchup_id") is not None: by.setdefault(m["matchup_id"], []).append(m)
            for g in by.values():
                if len(g) != 2 or not ((g[0].get("points") or 0) or (g[1].get("points") or 0)): continue
                for a, b in ((g[0], g[1]), (g[1], g[0])):
                    srows.append((label, int(season), wk, a["roster_id"], 1.0 if a["points"] > b["points"] else 0.5 if a["points"] == b["points"] else 0.0, a["points"]))
STAND = pd.DataFrame(srows, columns=["league", "season", "week", "roster_id", "win", "pf"])
STAND.to_parquet(os.path.join(OUT, "weekly_results.parquet"))
def weeks_done(ts):
    s = ts.year if ts.month >= 9 else ts.year - 1
    k = pd.Timestamp(KICK.get(s, f"{s}-09-08")) + pd.Timedelta(days=5)
    return s, (int(np.clip((ts - k).days // 7 + 1, 0, 18)) if ts >= k else 0)
cx = {}
for tid, g in X.groupby("tid"):
    lg, t = g.league.iloc[0], pd.Timestamp(g.date.iloc[0]); n = FMT[lg]["teams"]
    rk = VAL.roster_ranks(lg, t); s_, w_ = weeks_done(t); order = None
    if t.month in (9, 10, 11, 12) and w_ >= 3:                         # in season: the standings count too
        d = STAND[(STAND.league == lg) & (STAND.season == s_) & (STAND.week <= w_)]
        if d.week.nunique() >= 3:
            a = d.groupby("roster_id").agg(w=("win", "sum"), pf=("pf", "sum")).sort_values(["w", "pf"], ascending=False)
            order = {int(r): i for i, r in enumerate(a.index)}
    for rid in g.roster_id:
        rp = (rk.get(rid, (n + 1) / 2) - 1) / max(1, n - 1)
        sp = order[rid] / max(1, n - 1) if order and rid in order else np.nan
        cx[(tid, rid)] = (rp, sp, rp if sp != sp else (rp + sp) / 2)
X["roster_pct"] = [cx[(a, b)][0] for a, b in zip(X.tid, X.roster_id)]
X["standing_pct"] = [cx[(a, b)][1] for a, b in zip(X.tid, X.roster_id)]
X["ctx_index"] = [cx[(a, b)][2] for a, b in zip(X.tid, X.roster_id)]                 # 0 = strongest team in the league, 1 = weakest
X["context"] = np.select([X.ctx_index <= 1 / 3, X.ctx_index >= 2 / 3], ["Contending", "Rebuilding"], "Middle")
POINTS_CREDIT = {"Contending": 1.0, "Middle": 0.5, "Rebuilding": 0.0}             # share of the 12-month lineup-point result that counts
wins_ = lambda q: q.clip(q.quantile(.01), q.quantile(.99))

def grade(v):
    return "A+" if v >= 3000 else "A" if v >= 1500 else "B" if v >= 500 else "C" if v > -500 else "D" if v > -1500 else "F"
def aged(d):
    return "Aged much better" if d >= 1500 else "Aged better" if d >= 500 else "Held its value" if d > -500 else "Aged worse" if d > -1500 else "Aged much worse"
def consensus(r):
    if r.net_then <= -500 and r.v_out >= 1.3 * max(r.v_in, 1): base = "Bold bet against consensus"
    elif r.net_then >= 500 and r.v_in >= 1.3 * max(r.v_out, 1): base = "Won by consensus at the time"
    else: base = "Fair by consensus"
    out = "paid off" if r.net_now >= 500 else "backfired" if r.net_now <= -500 else "came out even"
    if base.startswith("Won"): out = "held up" if r.net_now >= 500 else "flipped against" if r.net_now <= -500 else "evened out"
    return f"{base} — {out}"
X["grade"] = X.net_now.map(grade); X["aging"] = X.delta.map(aged); X["consensus"] = X.apply(consensus, axis=1)
X["active"] = (X.gross_then > 0) | (X.gross_now > 0)
# undone trades: the same players go back between the same two rosters within 24 hours -> exclude both halves
Tm = T.assign(date=pd.to_datetime(T.ts, unit="ms"))
def pmoves(r):
    adds, drops = json.loads(r.adds), json.loads(r.drops)
    return frozenset((p, drops.get(p), to) for p, to in adds.items())
Tm["pm"] = Tm.apply(pmoves, axis=1)
undone = set()
for l, g in Tm.groupby("league"):
    g = g.sort_values("ts")
    for _, a in g.iterrows():
        if not a.pm: continue
        back = frozenset((p, to, frm) for p, frm, to in a.pm)
        c = g[(g.ts > a.ts) & (g.ts <= a.ts + 86400 * 1000)]
        for _, b in c.iterrows():
            if b.pm and {p for p, _, _ in b.pm} == {p for p, _, _ in a.pm} and b.pm == back:
                undone.update([a.tid, b.tid])
X["undone"] = X.tid.isin(undone)
X.loc[X.undone, "active"] = False
# redone trades: a later trade between the same rosters within 48 hours repeats at least half of the earlier one's moves in the same
# direction -> the earlier one was replaced (Dynasty Bois, 6 Jan 2023: executed in the archived 2022 league minutes before the 2023 league
# took over, then redone there with one player changed); count only the later one
def moves(r):
    m = {("P", p, to) for p, to in json.loads(r.adds).items()}
    return m | {("K", p["season"], p["round"], p["roster_id"], p["owner_id"]) for p in json.loads(r.picks)}
Tm["mv"] = Tm.apply(moves, axis=1); Tm["rs"] = Tm.roster_ids.map(lambda s: tuple(sorted(json.loads(s))))
superseded = set()
for l, g in Tm.groupby("league"):
    g = g.sort_values("ts")
    for _, a in g.iterrows():
        if not a.mv or a.tid in undone: continue
        c = g[(g.ts > a.ts) & (g.ts <= a.ts + 2 * 86400 * 1000) & (g.rs == a.rs) & ~g.tid.isin(undone)]
        if any(b.mv and len(a.mv & b.mv) >= max(1, 0.5 * min(len(a.mv), len(b.mv))) for _, b in c.iterrows()): superseded.add(a.tid)
X["superseded"] = X.tid.isin(superseded)
X.loc[X.superseded, "active"] = False
A_ = X[X.active]
PTS_TO_VALUE = float(wins_(A_.net_now).std() / wins_(A_.pts_net).std())         # one SD of lineup points = one SD of value
X["points_credit"] = X.context.map(POINTS_CREDIT)
X["pts_value"] = X.pts_net * PTS_TO_VALUE
# the context-adjusted result, in value points: everyone keeps the full value result (so an egregious value loss always counts);
# a contender also gets credit or blame for the lineup points gained or lost in the next 12 months, a middle team half of it,
# and a rebuilding (or tanking) team none -- losing production is the point of selling.
X["ctx_net"] = X.net_now + X.points_credit * X.pts_value
X["grade_value"] = X.grade; X["grade"] = X.ctx_net.map(grade)
X["big"] = np.select([X.ctx_net >= 1500, X.ctx_net <= -1500], ["Big win", "Big loss"], "")
print("points-to-value rate:", round(PTS_TO_VALUE, 2), "| contexts:", X[X.active].context.value_counts().to_dict())
print("undone trades excluded:", len(undone) // 2, "pairs | redone trades excluded (earlier copy):", len(superseded))
X.to_parquet(os.path.join(OUT, "trade_ledger.parquet"))
R = {}

# ---------------- Brett ----------------
B = X[X.manager == ME].copy().sort_values(["ctx_net", "net_now"], ascending=False)
B["rank_now"] = np.arange(1, len(B) + 1)                                        # rank by the context-adjusted result
B["rank_value"] = B.net_now.rank(ascending=False, method="first").astype(int)    # rank by value today alone
B["rank_aging"] = B.delta.rank(ascending=False, method="first").astype(int)
cols = ["rank_now", "rank_value", "rank_aging", "date", "league", "partner", "got", "gave", "shape", "context", "v_in", "v_out", "now_in", "now_out", "net_then", "net_1y", "net_2y", "net_3y",
        "net_now", "delta", "pts_got", "pts_partner", "pts_net", "ctx_net", "grade", "grade_value", "big", "aging", "consensus", "age_in", "age_out", "category"]
B[cols].assign(date=B.date.dt.strftime("%Y-%m-%d")).to_csv(os.path.join(OUT, "brett_trades_ranked.csv"), index=False)
R["brett_trades"] = B[cols].assign(date=B.date.dt.strftime("%Y-%m-%d")).round(1).to_dict("records")
Ba = B[B.active]
def summ(d):
    g, l_ = d.ctx_net[d.ctx_net > 0].sum(), -d.ctx_net[d.ctx_net < 0].sum()
    out = dict(n=len(d), wins=int((d.ctx_net > 0).sum()), losses=int((d.ctx_net < 0).sum()), even=int((d.ctx_net == 0).sum()), total_ctx=float(d.ctx_net.sum()),
               vw_share=float(g / (g + l_)) if g + l_ else np.nan, big_wins=int((d.ctx_net >= 1500).sum()), big_losses=int((d.ctx_net <= -1500).sum()),
               wins_value=int((d.net_now > 0).sum()), losses_value=int((d.net_now < 0).sum()), total_net_now=float(d.net_now.sum()), total_net_then=float(d.net_then.sum()),
               total_delta=float(d.delta.sum()), pts_got=float(d.pts_got.sum()), pts_partner=float(d.pts_partner.sum()), pts_net=float(d.pts_net.sum()),
               grades=d.grade.value_counts().to_dict(), grades_value=d.grade_value.value_counts().to_dict(), aging=d.aging.value_counts().to_dict(), consensus=d.consensus.value_counts().to_dict())
    for h in (1, 2, 3):
        o = d[d[f"net_{h}y"].notna()]
        out[f"n_{h}y"] = len(o); out[f"wins_{h}y"] = int((o[f"net_{h}y"] > 0).sum()); out[f"losses_{h}y"] = int((o[f"net_{h}y"] < 0).sum()); out[f"total_{h}y"] = float(o[f"net_{h}y"].sum())
        out[f"now_same_{h}y"] = float(o.net_now.sum())                            # the same trades judged today, for comparison
    return out
R["brett_summary"] = dict(active=len(Ba), **summ(Ba)); R["brett_summary"]["n"] = len(B)
R["lm_summary"] = summ(X[X.active & (X.manager != ME)])
R["brett_by_context"] = [dict(context=c, **summ(Ba[Ba.context == c])) for c in ["Contending", "Middle", "Rebuilding"]]
R["lm_by_context"] = [dict(context=c, **summ(X[X.active & (X.manager != ME) & (X.context == c)])) for c in ["Contending", "Middle", "Rebuilding"]]
R["method"] = dict(pts_to_value=PTS_TO_VALUE, points_credit=POINTS_CREDIT, big=1500)
L = X[X.active & (X.manager != ME)]
R["lm_consensus"] = L.consensus.value_counts(normalize=True).round(4).to_dict()
R["brett_consensus_share"] = Ba.consensus.value_counts(normalize=True).round(4).to_dict()
# bold bets: success rate vs league-mates
bb, bl = Ba[Ba.consensus.str.startswith("Bold")], L[L.consensus.str.startswith("Bold")]
R["bold"] = dict(brett_n=len(bb), brett_share=float(len(bb) / len(Ba)), brett_paid=float((bb.net_now >= 500).mean()), brett_backfired=float((bb.net_now <= -500).mean()),
                 lm_share=float(len(bl) / len(L)), lm_paid=float((bl.net_now >= 500).mean()), lm_backfired=float((bl.net_now <= -500).mean()))
# timeline & ages at trade
B["year"] = B.date.dt.year
tl = B.groupby("year").agg(trades=("tid", "size"), net_now=("net_now", "sum"), age_in=("age_in", "mean"), age_out=("age_out", "mean")).reset_index()
R["timeline_year"] = tl.round(2).to_dict("records")
PHASES = {1: "Jan–Feb", 2: "Jan–Feb", 3: "Mar–Apr", 4: "Mar–Apr", 5: "May–Jun", 6: "May–Jun", 7: "Jul–Aug", 8: "Jul–Aug", 9: "Sep–Oct", 10: "Sep–Oct", 11: "Nov–Dec", 12: "Nov–Dec"}
B["month_et"] = B.date.dt.tz_localize("UTC").dt.tz_convert("America/New_York").dt.month
B["season_phase"] = B.month_et.map(PHASES)
R["phase"] = B[B.active].groupby("season_phase").agg(trades=("tid", "size"), wins=("ctx_net", lambda s: int((s > 0).sum())), losses=("ctx_net", lambda s: int((s < 0).sum())),
                                         win_rate=("ctx_net", lambda s: float((s > 0).sum() / max(1, (s != 0).sum()))), avg_net=("ctx_net", "mean"), avg_value=("net_now", "mean"),
                                         age_in=("age_in", "mean")).round(3).reset_index().to_dict("records")
L2 = X[X.manager != ME].assign(year=X.date.dt.year)
R["age_by_year_lm"] = L2.groupby("year").agg(age_in=("age_in", "mean"), age_out=("age_out", "mean")).round(2).reset_index().to_dict("records")
# ages by position at trade (per player, from trade_sides)
TSx = TS.copy()
recs = []
for r in TSx.itertuples():
    ai, ao, pi, po = json.loads(r.age_in), json.loads(r.age_out), json.loads(r.pos_in), json.loads(r.pos_out)
    pin = [p for p, pl in zip(pi, json.loads(r.players_in)) if pd.notna(PH.birth_date.get(pl))]
    pout = [p for p, pl in zip(po, json.loads(r.players_out)) if pd.notna(PH.birth_date.get(pl))]
    for a, p in zip(ai, pin): recs.append((r.manager == ME, "in", p, a, r.date.year))
    for a, p in zip(ao, pout): recs.append((r.manager == ME, "out", p, a, r.date.year))
AG = pd.DataFrame(recs, columns=["me", "side", "pos", "age", "year"])
R["age_by_pos"] = AG[AG.pos.isin(["QB", "RB", "WR", "TE"])].groupby(["pos", "side", "me"]).age.mean().round(2).unstack().rename(columns={True: "brett", False: "lm"}).reset_index().to_dict("records")
R["age_by_year_brett"] = AG[AG.me].groupby(["year", "side"]).age.mean().round(2).unstack().reset_index().to_dict("records")
R["pos_by_year_brett"] = AG[AG.me & (AG.side == "in")].groupby(["year", "pos"]).size().unstack(fill_value=0).reset_index().to_dict("records")
# partners: net result by partner
Ba = Ba.assign(pkey=Ba.partner_ids.map(lambda l: l[0] if l else None))
pr = Ba.groupby(["league", "pkey"]).agg(trades=("tid", "size"), net_now=("net_now", "sum"), ctx_net=("ctx_net", "sum"), wins=("ctx_net", lambda s: int((s > 0).sum())),
                                        losses=("ctx_net", lambda s: int((s < 0).sum())), last=("season", "max")).reset_index()
pr["partner"] = [team(l, s, k) for l, s, k in zip(pr.league, pr["last"], pr.pkey)]; pr["partner_mgr"] = pr.pkey.map(uname)
R["brett_partners"] = pr.sort_values("trades", ascending=False).head(12).drop(columns=["pkey"]).to_dict("records")

# ---------------- league-wide top 50s ----------------
act = X[X.active]
tr = []
for tid, g in act.groupby("tid"):
    if len(g) < 2: continue
    w = g.loc[g.net_now.idxmax()]; lo = g.loc[g.net_now.idxmin()]
    wthen = g.loc[g.net_then.idxmax()]
    tr.append(dict(tid=tid, league=w.league, date=w.date.strftime("%Y-%m-%d"), season=int(w.season), winner=w.team, winner_mgr=w.manager_name, winner_id=w.manager, winner_got=w.got,
                   loser=lo.team, loser_mgr=lo.manager_name, loser_id=lo.manager, loser_got=lo.got, gap_now=float(w.net_now), gap_then=float(w.net_then),
                   w_then_in=float(w.v_in), w_then_out=float(w.v_out), w_now_in=float(w.now_in), w_now_out=float(w.now_out), moved=float(w.delta),
                   flipped=bool(wthen.manager != w.manager and abs(w.net_then) >= 300), sides=len(g), involves_brett=bool((g.manager == ME).any()),
                   winner_grade=grade(w.net_now), aging=aged(w.delta), consensus=w.consensus, winner_context=w.context, loser_context=lo.context,
                   winner_ctx=float(w.ctx_net), loser_ctx=float(lo.ctx_net), winner_pts=float(w.pts_net), loser_pts=float(lo.pts_net)))
TT = pd.DataFrame(tr)
TT.to_csv(os.path.join(OUT, "all_trades_lopsided.csv"), index=False)
R["top50_now"] = TT.sort_values("gap_now", ascending=False).head(50).round(1).to_dict("records")
R["top50_moved"] = TT.assign(absmove=TT.moved.abs()).sort_values("absmove", ascending=False).head(50).round(1).to_dict("records")
th = []
for tid, g in act.groupby("tid"):
    if len(g) < 2: continue
    wt, lt = g.loc[g.net_then.idxmax()], g.loc[g.net_then.idxmin()]
    th.append(dict(tid=tid, league=wt.league, date=wt.date.strftime("%Y-%m-%d"), winner=wt.team, winner_mgr=wt.manager_name, winner_id=wt.manager, winner_got=wt.got,
                   loser=lt.team, loser_mgr=lt.manager_name, loser_id=lt.manager, loser_got=lt.got, gap_then=float(wt.net_then), then_winner_now=float(wt.net_now),
                   w_then_in=float(wt.v_in), w_then_out=float(wt.v_out), involves_brett=bool((g.manager == ME).any())))
R["top25_then"] = pd.DataFrame(th).sort_values("gap_then", ascending=False).head(25).round(1).to_dict("records")
R["n_trades_all"] = int(len(TT)); R["n_flipped"] = int(TT.flipped.sum()); R["n_undone_pairs"] = len(undone) // 2
R["brett_in_top50"] = dict(as_winner=int(sum(1 for r in R["top50_now"] if r["winner_id"] == ME)), as_loser=int(sum(1 for r in R["top50_now"] if r["loser_id"] == ME)))

# ---------------- trader rankings ----------------
tl_ = {}
for t in titles:
    if t["champion_owner"]: tl_.setdefault((t["league"], t["champion_owner"]), []).append(t["season"])
def trader_table(d, group_cols, min_trades=5):
    """Rank managers on the context-adjusted result of their trades: half the weight on the total (how much they gained), a quarter
    on the value-weighted win share (big trades count for more than small ones), a quarter on the plain win rate (consistency).
    Rates are shrunk toward 50% so a handful of trades can't top the list. Alternative rankings are kept to show how robust each rank is."""
    g = d.groupby(group_cols)
    pos = lambda s: s[s > 0].sum(); neg = lambda s: -s[s < 0].sum()
    t = pd.DataFrame({"trades": g.size(), "wins": g.ctx_net.apply(lambda s: int((s > 0).sum())), "losses": g.ctx_net.apply(lambda s: int((s < 0).sum())),
                      "big_wins": g.ctx_net.apply(lambda s: int((s >= 1500).sum())), "big_losses": g.ctx_net.apply(lambda s: int((s <= -1500).sum())),
                      "total_ctx": g.ctx_net.sum(), "gained": g.ctx_net.apply(pos), "lost": g.ctx_net.apply(neg),
                      "total_now": g.net_now.sum(), "total_then": g.net_then.sum(), "total_delta": g.delta.sum(), "pts_net": g.pts_net.sum(),
                      "total_1y": g.net_1y.sum(min_count=1), "n_1y": g.net_1y.count(), "total_3y": g.net_3y.sum(min_count=1), "n_3y": g.net_3y.count(),
                      "wins_value": g.net_now.apply(lambda s: int((s > 0).sum())), "losses_value": g.net_now.apply(lambda s: int((s < 0).sum())),
                      "contending": g.context.apply(lambda s: float((s == "Contending").mean())), "rebuilding": g.context.apply(lambda s: float((s == "Rebuilding").mean())),
                      "best": g.apply(lambda x: x.loc[x.ctx_net.idxmax()].got + "  ⟵  " + x.loc[x.ctx_net.idxmax()].gave),
                      "best_val": g.ctx_net.max(), "worst": g.apply(lambda x: x.loc[x.ctx_net.idxmin()].got + "  ⟵  " + x.loc[x.ctx_net.idxmin()].gave), "worst_val": g.ctx_net.min(),
                      "seasons": g.season.nunique()}).reset_index()
    t["win_rate"] = t.wins / (t.wins + t.losses).replace(0, np.nan)
    t["vw_share"] = t.gained / (t.gained + t.lost).replace(0, np.nan)
    t["win_rate_value"] = t.wins_value / (t.wins_value + t.losses_value).replace(0, np.nan)
    t["shrunk_wr"] = (t.wins + 2.5) / (t.wins + t.losses + 5)
    t["shrunk_vw"] = (t.gained + 2500) / (t.gained + t.lost + 5000)              # a prior worth one mid-sized trade each way
    t["qualified"] = t.trades >= min_trades
    q = t[t.qualified].copy()
    for c in ["total_ctx", "shrunk_vw", "shrunk_wr"]:
        q[c + "_pct"] = q[c].rank(pct=True)
    q["score"] = 0.5 * q.total_ctx_pct + 0.25 * q.shrunk_vw_pct + 0.25 * q.shrunk_wr_pct
    q = q.sort_values(["score", "total_ctx"], ascending=False)                  # ties on the blended score go to the bigger total
    q["rank"] = np.arange(1, len(q) + 1)
    # how robust is each rank? rank again on single measures
    alt = {"rank_value_today": "total_now", "rank_context_total": "total_ctx", "rank_one_year": "total_1y", "rank_three_year": "total_3y", "rank_points": "pts_net", "rank_big_trades": "net_big"}
    q["net_big"] = q.big_wins - q.big_losses
    for k, c in alt.items(): q[k] = q[c].rank(ascending=False, method="min")
    q["rank_best"] = q[list(alt)].min(axis=1); q["rank_worst"] = q[list(alt)].max(axis=1)
    n = len(q)
    def g_(rk):
        f = (rk - 1) / max(1, n - 1)
        return "A+" if f <= 0.10 else "A" if f <= 0.25 else "B" if f <= 0.45 else "C" if f <= 0.65 else "D" if f <= 0.85 else "F"
    q["grade"] = q["rank"].map(g_)
    def style(r):
        a = r.total_then / r.trades; b = r.total_delta / r.trades
        if a > 50 and b > 50: return "Wins the deal and the future"
        if a > 50: return "Wins at the table (market value)"
        if b > 50: return "Wins with foresight (assets appreciate)"
        return "Gives value on both counts"
    q["style"] = q.apply(style, axis=1)
    t = t.merge(q[group_cols + ["score", "rank", "grade", "style", "net_big"] + list(alt) + ["rank_best", "rank_worst"]], on=group_cols, how="left")
    return t.sort_values(["qualified", "rank"], ascending=[False, True])
def robustness(tt):
    """Spearman correlation between the headline rank and each single-measure rank"""
    q = tt[tt.qualified]
    return {k: float(stats.spearmanr(q["rank"], q[k]).statistic) for k in ["rank_value_today", "rank_context_total", "rank_one_year", "rank_three_year", "rank_points", "rank_big_trades"]
            if q[k].notna().sum() > 3}
TB = trader_table(act[act.league == "Dynasty Bois"], ["manager"])
TB["name"] = TB.manager.map(uname); TB["team_latest"] = TB.manager.map(lambda u: team("Dynasty Bois", 2026, u))
TB["titles"] = TB.manager.map(lambda u: tl_.get(("Dynasty Bois", u), []))
R["traders_bois"] = TB.round(3).to_dict("records"); R["robust_bois"] = robustness(TB)
TA = trader_table(act, ["manager"], min_trades=10)
TA["name"] = TA.manager.map(uname)
TA["leagues"] = TA.manager.map(act.groupby("manager").league.agg(lambda s: sorted(set(s))))
TA["titles"] = TA.manager.map(lambda u: [f"{l} {s}" for (l, uu), ss in tl_.items() if uu == u for s in ss])
R["traders_all"] = TA.round(3).to_dict("records"); R["robust_all"] = robustness(TA)
TL = pd.concat([trader_table(act[act.league == l], ["league", "manager"]) for l in sorted(act.league.unique())], ignore_index=True); TL["name"] = TL.manager.map(uname)
R["traders_by_league"] = TL[TL.qualified].round(3).to_dict("records")
R["brett_rank_by_league"] = TL[TL.manager == ME][["league", "trades", "wins", "losses", "win_rate", "total_ctx", "total_now", "rank", "grade", "style", "rank_best", "rank_worst"]].merge(TL[TL.qualified].groupby("league").size().rename("of").reset_index(), on="league").to_dict("records")
TB.to_csv(os.path.join(OUT, "traders_dynasty_bois.csv"), index=False); TA.to_csv(os.path.join(OUT, "traders_all_leagues.csv"), index=False)
json.dump(R, open(os.path.join(OUT, "analysis_trades.json"), "w"), default=lambda o: None if (isinstance(o, float) and np.isnan(o)) else (o.item() if hasattr(o, "item") else (o.strftime("%Y-%m-%d") if hasattr(o, "strftime") else str(o))))

pd.set_option("display.width", 250); pd.set_option("display.max_colwidth", 60)
print("Brett summary:", R["brett_summary"])
print("bold:", R["bold"])
print(B[["rank_now", "rank_value", "date", "league", "context", "got", "net_then", "net_now", "pts_net", "ctx_net", "grade"]].head(8).to_string())
print(B[["rank_now", "rank_value", "date", "league", "context", "got", "net_now", "pts_net", "ctx_net", "grade"]].tail(6).to_string())
print("by context:", pd.DataFrame(R["brett_by_context"])[["context", "n", "wins", "losses", "total_ctx", "total_net_now", "pts_net"]].round(0).to_string())
print("\nTOP 10 NOW:"); print(pd.DataFrame(R["top50_now"])[["league", "date", "winner", "winner_got", "loser", "loser_got", "gap_then", "gap_now"]].head(10).to_string())
print("\nBois traders:"); print(TB[["name", "trades", "wins", "losses", "big_wins", "big_losses", "vw_share", "total_ctx", "total_now", "pts_net", "rank", "grade", "rank_best", "rank_worst", "titles"]].round(2).to_string())
print("robust bois", R["robust_bois"], "| robust all", R["robust_all"])
print("\nAll-league top 15:"); print(TA[TA.qualified][["name", "trades", "wins", "losses", "vw_share", "total_ctx", "total_now", "rank", "grade", "rank_best", "rank_worst"]].head(15).round(2).to_string())
print("Brett overall:", TA[TA.manager == ME][["trades", "wins", "losses", "vw_share", "total_ctx", "total_now", "rank", "grade", "rank_best", "rank_worst"]].to_dict("records"), "of", int(TA.qualified.sum()))
print("Brett by league:", R["brett_rank_by_league"])
print("flipped:", R["n_flipped"], "of", R["n_trades_all"], "| Brett in top50:", R["brett_in_top50"])
