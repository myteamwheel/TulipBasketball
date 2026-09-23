"""DynastyProcess value lookups shared by the trade analyses.

Players: monthly DynastyProcess values (superflex or 1QB to match the league).
Picks are valued in context, never by the one player a manager happened to take with them:
  - before the league's rookie draft: the market price of the pick given what was knowable at that moment -- the exact slot once
    last season is over (the order is set), otherwise the early / middle / late third of the round according to how strong the
    original owner's roster was at the time; picks two or more drafts out get the round average.
  - after the draft: the slot's value -- the typical current value of the players taken within two picks of that slot in the
    same class, pooled across all same-format leagues' drafts (a trimmed mean: the best and worst ~10% near the slot are dropped, so
    one late hit like Puka Nacua at 48th doesn't make a whole round valuable), smoothed so an earlier pick is never worth less.
"""
import json, os, re, math
import numpy as np, pandas as pd
from common import *

FMT = {l: f for l, _, f in LEAGUES}
NOW = pd.Timestamp(AS_OF_DATE)
DL = pd.read_parquet(os.path.join(OUT, "dp_long.parquet"))
RD = pd.read_parquet(os.path.join(OUT, "rookie_picks.parquet"))
PH = pd.read_parquet(os.path.join(OUT, "players_hist.parquet")).set_index("player_id")

dates = np.array(sorted(DL.date.unique()))
_PL = DL[(DL.pos != "PICK") & DL.fp_id.notna()]
_fps = sorted(_PL.fp_id.unique()); fpi = {f: i for i, f in enumerate(_fps)}
V2 = np.zeros((len(dates), len(_fps))); V1 = np.zeros((len(dates), len(_fps)))
_di = {d: i for i, d in enumerate(dates)}
for r in _PL.itertuples():
    i, j = _di[r.date], fpi[r.fp_id]
    V2[i, j] = max(V2[i, j], r.value_2qb if r.value_2qb == r.value_2qb else 0)
    V1[i, j] = max(V1[i, j], r.value_1qb if r.value_1qb == r.value_1qb else 0)

def didx(t):
    t = pd.Timestamp(t)
    if t.tzinfo is not None: t = t.tz_convert("UTC").tz_localize(None)
    i = np.searchsorted(dates, np.datetime64(t), side="right") - 1
    return int(i) if i >= 0 else None

def _col(pid):
    j = fpi.get(PH.fp_id.get(pid)) if pid is not None else None
    return -1 if j is None else j

def player_value(pid, t, sf):
    """value of a Sleeper player id at time t (0 = unranked, nan = before the value history starts)"""
    i = didx(t)
    if i is None: return np.nan
    j = _col(pid)
    return 0.0 if j < 0 else float((V2 if sf else V1)[i, j])

# ---------------- roster strength (sum of player values on each roster at a moment) ----------------
_ST = pd.read_parquet(os.path.join(OUT, "stints.parquet"))[["league", "roster_id", "player_id", "start", "end"]].copy()
_ST["end_f"] = _ST.end.fillna(NOW + pd.Timedelta(days=1))
_ST["j"] = _ST.player_id.map(_col)
_STL = {l: g.reset_index(drop=True) for l, g in _ST.groupby("league")}
_rr = {}
def roster_ranks(league, t):
    """{roster_id: rank} by total player value at time t (1 = strongest)"""
    key = (league, pd.Timestamp(t))
    if key not in _rr:
        g = _STL[league]; on = g[(g.start < t) & (g.end_f >= t)]
        i = didx(t)
        if i is None or on.empty: _rr[key] = {}
        else:
            M = V2 if FMT[league]["sf"] else V1
            v = np.where(on.j.values >= 0, M[i, np.maximum(on.j.values, 0)], 0.0)
            tot = pd.Series(v).groupby(on.roster_id.values).sum()
            _rr[key] = {int(r): int(k) for r, k in tot.rank(ascending=False, method="first").items()}
    return _rr[key]

# ---------------- pick market values ----------------
_ORD = {"1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5, "6th": 6}
_snap = {}
for d, g in DL[DL.pos == "PICK"].groupby("date"):
    slots, generic = {}, {}
    for r in g.itertuples():
        m = re.match(r"(\d{4}) Pick (\d)\.(\d\d)", r.player)
        if m:
            slots[(int(m.group(1)), int(m.group(2)), int(m.group(3)))] = (r.value_2qb, r.value_1qb); continue
        m = re.match(r"(\d{4}) (?:(Early|Mid|Late) )?(\d(?:st|nd|rd|th))", r.player)
        if m:
            generic.setdefault((int(m.group(1)), _ORD[m.group(3)]), {})[m.group(2) or "Gen"] = (r.value_2qb, r.value_1qb)
    _snap[d] = (slots, generic)

def slot_market(y, k, t, sf):
    """market value of the k-th rookie taken in class y, at time t (DynastyProcess's 12-team pick curve)"""
    i = didx(t)
    if i is None: return np.nan
    slots, generic = _snap[dates[i]]
    rd = math.ceil(k / 12); ss = k - (rd - 1) * 12; c = 0 if sf else 1
    if (y, rd, ss) in slots: return slots[(y, rd, ss)][c]
    if y in {a for a, _, _ in slots}: return 0.0                     # beyond the listed rounds
    yg = {a for a, _ in generic}
    yy = y if y in yg else (max(yg) if yg and y > max(yg) else None)
    if yy is None: return np.nan
    g = generic.get((yy, rd))
    if not g: return 0.0
    if "Gen" in g: return g["Gen"][c]
    tier = "Early" if ss <= 4 else "Mid" if ss <= 8 else "Late"
    return g[tier][c] if tier in g else float(np.mean([v[c] for v in g.values()]))

def round_market(y, rnd, n, t, sf, part=None):
    """average market value of a round's picks in an n-team league; part 0/1/2 = its early/middle/late third"""
    ks = np.arange((rnd - 1) * n + 1, rnd * n + 1)
    if part is not None: ks = np.array_split(ks, 3)[part]
    vals = [slot_market(y, int(k), t, sf) for k in ks]
    vals = [v for v in vals if v == v]
    return float(np.mean(vals)) if vals else np.nan

rd_player = {(r.league, int(r.season), int(r["round"]), r.orig_roster): r.player_id for _, r in RD.iterrows()}
rd_pickno = {(r.league, int(r.season), int(r["round"]), r.orig_roster): int(r.pick_no) for _, r in RD.iterrows()}
rd_date = {k: pd.to_datetime(v, unit="ms") for k, v in RD.groupby(["league", "season"]).ts.min().items()}
_drafts = {}
for (l, s), d in rd_date.items(): _drafts.setdefault(l, []).append((int(s), d))

def next_draft_season(league, t):
    for s, d in sorted(_drafts.get(league, [])):
        if d > t: return s
    last = max([s for s, _ in _drafts.get(league, [])], default=None)
    base = t.year if t.month <= 6 else t.year + 1
    return max(last + 1, base) if last is not None else base

def _pav_decreasing(y, w):
    """weighted least-squares fit of a non-increasing sequence (pool adjacent violators)"""
    ys, ws, ns = [], [], []
    for yi, wi in zip(y, np.maximum(w, 1e-9)):
        ys.append(float(yi)); ws.append(float(wi)); ns.append(1)
        while len(ys) > 1 and ys[-2] < ys[-1]:
            ww = ws[-2] + ws[-1]
            ys[-2:] = [(ys[-2] * ws[-2] + ys[-1] * ws[-1]) / ww]; ws[-2:] = [ww]; ns[-2:] = [ns[-2] + ns[-1]]
    return np.repeat(ys, ns)

def _robust_mean(x):
    """average outcome near a slot without letting one hit (or one bust) define it: drop the top and bottom ~10% (at least one each)
    when there are 5+ players, use the median for 3-4, the plain mean below that"""
    x = np.sort(np.asarray(x, dtype=float)); n = len(x)
    if n == 0: return 0.0
    if n >= 5:
        t = max(1, int(round(0.1 * n))); return float(x[t:n - t].mean())
    if n >= 3: return float(np.median(x))
    return float(x.mean())

_curves = {}
def class_curve(season, sf, i):
    """value (snapshot i) of the k-th rookie off the board in this class: trimmed mean of the players taken within 2 picks of k in
    every same-format league's draft, forced non-increasing in k"""
    key = (int(season), bool(sf), i)
    if key not in _curves:
        d = RD[(RD.season == int(season)) & RD.league.map(lambda l: FMT[l]["sf"] == sf)]
        if d.empty: _curves[key] = np.zeros(0)
        else:
            M = V2 if sf else V1
            v = np.array([M[i, _col(p)] if _col(p) >= 0 else 0.0 for p in d.player_id])
            pn = d.pick_no.values
            K = int(pn.max()); raw, w = np.zeros(K), np.zeros(K)
            for k in range(1, K + 1):
                m = np.abs(pn - k) <= 2
                raw[k - 1] = _robust_mean(v[m]); w[k - 1] = m.sum()
            _curves[key] = _pav_decreasing(raw, w)
    return _curves[key]

def pick_value_at(league, season, rnd, orig, t):
    """what a pick is worth at time t, in context (see module docstring). Returns (value, basis)."""
    f = FMT[league]; sf, n = f["sf"], f["teams"]; season, rnd = int(season), int(rnd)
    held = rd_date.get((league, season))
    k = rd_pickno.get((league, season, rnd, orig))
    if held is not None and held <= t:
        i = didx(t); c = class_curve(season, sf, i)
        kk = k if k is not None else int((rnd - 1) * n + (n + 1) // 2)
        return (float(c[min(kk, len(c)) - 1]) if len(c) else 0.0), "slot value after the draft"
    if season == next_draft_season(league, t):
        if k is not None and t >= pd.Timestamp(f"{season}-01-08"):
            v = slot_market(season, k, t, sf)
            return (v if v == v else 0.0), "known slot"
        rk = roster_ranks(league, t).get(orig)
        if rk is not None:
            part = 0 if rk > 2 * n / 3 else 2 if rk <= n / 3 else 1          # the weakest third of rosters pick early
            v = round_market(season, rnd, n, t, sf, part)
            return (v if v == v else 0.0), ["projected early", "projected middle", "projected late"][part]
    v = round_market(season, rnd, n, t, sf)
    return (v if v == v else 0.0), "round average"

def pick_drafted_value(league, season, rnd, orig, t, sf):
    """the old, one-player view: value at t of whoever was actually taken with the pick (for reference only)"""
    p = rd_player.get((league, int(season), int(rnd), orig))
    held = rd_date.get((league, int(season)))
    return (player_value(p, t, sf) if (p and held is not None and held <= t) else np.nan), p
