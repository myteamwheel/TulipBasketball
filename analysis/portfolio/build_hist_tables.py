"""Trade sides (valued then + hindsight), enriched stints (values, ranks, points), rookie-draft pick table, weekly lineups."""
import json, os, glob, re, math
import numpy as np, pandas as pd
from common import *

H = os.path.join(RAW, "sleeper", "history")
chains = json.load(open(os.path.join(H, "_chains.json")))
FMT = {l: f for l, _, f in LEAGUES}
PH = pd.read_parquet(os.path.join(OUT, "players_hist.parquet")).set_index("player_id")
DL = pd.read_parquet(os.path.join(OUT, "dp_long.parquet"))
NOW = pd.Timestamp(AS_OF_DATE)

# ---------------- player value matrices (monthly; 0 = unranked) ----------------
dates = np.array(sorted(DL.date.unique()))
PL = DL[(DL.pos != "PICK") & DL.fp_id.notna()]
fps = sorted(PL.fp_id.unique()); fpi = {f: i for i, f in enumerate(fps)}
V2 = np.zeros((len(dates), len(fps))); V1 = np.zeros((len(dates), len(fps)))
di = {d: i for i, d in enumerate(dates)}
for r in PL.itertuples():
    V2[di[r.date], fpi[r.fp_id]] = max(V2[di[r.date], fpi[r.fp_id]], r.value_2qb if r.value_2qb == r.value_2qb else 0)
    V1[di[r.date], fpi[r.fp_id]] = max(V1[di[r.date], fpi[r.fp_id]], r.value_1qb if r.value_1qb == r.value_1qb else 0)
def rankmat(V):
    R = np.full(V.shape, 9999.0)
    for i in range(V.shape[0]):
        v = V[i]; order = np.argsort(-v); rk = np.empty(len(v)); rk[order] = np.arange(1, len(v) + 1); rk[v <= 0] = 9999; R[i] = rk
    return R
R2, R1 = rankmat(V2), rankmat(V1)
def didx(t):
    i = np.searchsorted(dates, np.datetime64(t), side="right") - 1
    return int(i) if i >= 0 else None
def pv(fp, t, sf):
    i = didx(t); j = fpi.get(fp)
    if i is None or j is None: return 0.0 if i is not None else np.nan
    return float((V2 if sf else V1)[i, j])
def prank(fp, t, sf):
    i = didx(t); j = fpi.get(fp)
    if i is None or j is None: return 9999.0
    return float((R2 if sf else R1)[i, j])
def window_max(fp, t0, t1, sf):
    """max value and best rank over snapshots in [t0, t1]"""
    j = fpi.get(fp)
    if j is None: return 0.0, 9999.0
    i0 = didx(t0); i1 = didx(t1)
    i0 = 0 if i0 is None else i0
    if i1 is None or i1 < i0: return 0.0, 9999.0
    V = (V2 if sf else V1)[i0:i1 + 1, j]; R = (R2 if sf else R1)[i0:i1 + 1, j]
    return float(V.max()), float(R.min())

# ---------------- rookie-draft pick table (who used which original pick) ----------------
rows = []
for label, chain in chains.items():
    first = min(int(s) for s, _ in chain)
    for season, lid in chain:
        for d in json.load(open(os.path.join(H, lid, "drafts.json"))):
            if d.get("status") != "complete": continue
            full = json.load(open(os.path.join(H, lid, f"draft_{d['draft_id']}.json")))
            rounds = (d.get("settings") or {}).get("rounds", 0)
            if int(season) == first and rounds >= 10: continue            # startup
            s2r = {int(k): v for k, v in (full.get("slot_to_roster_id") or {}).items() if str(k).isdigit()}
            for p in json.load(open(os.path.join(H, lid, f"draftpicks_{d['draft_id']}.json"))):
                rows.append(dict(league=label, season=int(season), draft_id=d["draft_id"], round=p["round"], pick_no=p["pick_no"], slot=p.get("draft_slot"),
                                 orig_roster=s2r.get(p.get("draft_slot")), picker=p.get("roster_id"), player_id=str(p["player_id"]) if p.get("player_id") else None,
                                 ts=d.get("start_time")))
RD = pd.DataFrame(rows)
RD.to_parquet(os.path.join(OUT, "rookie_picks.parquet"))
import values as VAL                                                  # reads rookie_picks.parquet, so it is imported after it is written

# ---------------- trade sides ----------------
T = pd.read_parquet(os.path.join(OUT, "trades.parquet"))
sides = []
for t in T.itertuples():
    adds, drops, picks, faab = json.loads(t.adds), json.loads(t.drops), json.loads(t.picks), json.loads(t.faab)
    owners = {int(k): v for k, v in json.loads(t.owners).items()}
    date = pd.to_datetime(t.ts, unit="ms"); sf = FMT[t.league]["sf"]; n = FMT[t.league]["teams"]
    for rid in json.loads(t.roster_ids):
        pin = [p for p, r in adds.items() if r == rid]; pout = [p for p, r in drops.items() if r == rid]
        kin = [k for k in picks if k.get("owner_id") == rid]; kout = [k for k in picks if k.get("previous_owner_id") == rid]
        fin = sum(x["amount"] for x in faab if x.get("receiver") == rid); fout = sum(x["amount"] for x in faab if x.get("sender") == rid)
        def pval(ps, when):
            return sum(pv(PH.fp_id.get(p), when, sf) for p in ps)
        def kval(ks, when):                                           # picks in context: projected/known slot, then the slot's value
            return sum(VAL.pick_value_at(t.league, k["season"], k["round"], k["roster_id"], when)[0] for k in ks)
        later = date + pd.Timedelta(days=365); later2 = date + pd.Timedelta(days=730); later3 = date + pd.Timedelta(days=1095)
        ages = lambda ps: [((date - PH.birth_date.get(p)).days / 365.25) for p in ps if pd.notna(PH.birth_date.get(p))]
        sides.append(dict(league=t.league, season=t.season, tid=t.tid, date=date, roster_id=rid, manager=owners.get(rid), n_sides=len(json.loads(t.roster_ids)),
                          partners=[owners.get(r) for r in json.loads(t.roster_ids) if r != rid], players_in=pin, players_out=pout,
                          picks_in=[f"{k['season']} R{k['round']}" for k in kin], picks_out=[f"{k['season']} R{k['round']}" for k in kout], faab_in=fin, faab_out=fout,
                          v_in_players=pval(pin, date), v_out_players=pval(pout, date), v_in_picks=kval(kin, date), v_out_picks=kval(kout, date),
                          now_in=pval(pin, NOW) + kval(kin, NOW), now_out=pval(pout, NOW) + kval(kout, NOW),
                          y1_in=(pval(pin, later) + kval(kin, later)) if later <= NOW else np.nan, y1_out=(pval(pout, later) + kval(kout, later)) if later <= NOW else np.nan,
                          y2_in=(pval(pin, later2) + kval(kin, later2)) if later2 <= NOW else np.nan, y2_out=(pval(pout, later2) + kval(kout, later2)) if later2 <= NOW else np.nan,
                          y3_in=(pval(pin, later3) + kval(kin, later3)) if later3 <= NOW else np.nan, y3_out=(pval(pout, later3) + kval(kout, later3)) if later3 <= NOW else np.nan,
                          age_in=ages(pin), age_out=ages(pout), pos_in=[PH.pos.get(p) for p in pin], pos_out=[PH.pos.get(p) for p in pout]))
TS = pd.DataFrame(sides)
TS["v_in"] = TS.v_in_players + TS.v_in_picks.fillna(0); TS["v_out"] = TS.v_out_players + TS.v_out_picks.fillna(0)
TS["is_me"] = TS.manager == ME
def cat(r):
    pi, po, ki, ko = len(r.players_in), len(r.players_out), len(r.picks_in), len(r.picks_out)
    got, gave = bool(pi or ki), bool(po or ko)
    if not got and not gave: return "FAAB only"
    if gave and not got: return "Gave assets for FAAB / nothing"
    if got and not gave: return "Got assets for FAAB / nothing"
    if po and not pi and ki and not ko: return "Sold players for picks"
    if pi and not po and ko and not ki: return "Bought players with picks"
    if pi and po and not ki and not ko: return "Player-for-player"
    if not pi and not po: return "Pick swap"
    return "Players + picks, mixed"
TS["category"] = TS.apply(cat, axis=1)
for c in ["players_in", "players_out", "picks_in", "picks_out", "partners", "age_in", "age_out", "pos_in", "pos_out"]:
    TS[c] = TS[c].map(json.dumps)
TS.to_parquet(os.path.join(OUT, "trade_sides.parquet"))
print("trade sides:", len(TS), "| Brett:", int(TS.is_me.sum()), TS[TS.is_me].category.value_counts().to_dict())

# ---------------- weekly lineups ----------------
kick = {2021: "2021-09-09", 2022: "2022-09-08", 2023: "2023-09-07", 2024: "2024-09-05", 2025: "2025-09-04", 2026: "2026-09-10"}
W = []
for label, chain in chains.items():
    for season, lid in chain:
        own = {r["roster_id"]: r.get("owner_id") for r in json.load(open(os.path.join(H, lid, "rosters.json")))}
        for f in sorted(glob.glob(os.path.join(H, lid, "matchups_*.json"))):
            wk = int(f[-7:-5]); sunday = pd.Timestamp(kick[int(season)]) + pd.Timedelta(days=3 + 7 * (wk - 1))
            for m in json.load(open(f)) or []:
                st = set(m.get("starters") or []); pp = m.get("players_points") or {}
                for p in m.get("players") or []:
                    W.append((label, int(season), wk, sunday, m["roster_id"], own.get(m["roster_id"]), p, p in st, float(pp.get(p, 0) or 0)))
W = pd.DataFrame(W, columns=["league", "season", "week", "date", "roster_id", "owner", "player_id", "started", "points"])
W = W[W.date <= NOW]
W.to_parquet(os.path.join(OUT, "weekly_lineups.parquet"))
print("weekly lineup rows:", len(W), "| weeks with data:", W.groupby(["league", "season"]).week.nunique().sum())

# ---------------- enriched stints ----------------
S = pd.read_parquet(os.path.join(OUT, "stints.parquet"))
S["sf"] = S.league.map(lambda l: FMT[l]["sf"]); S["n_teams"] = S.league.map(lambda l: FMT[l]["teams"])
S["fp_id"] = S.player_id.map(PH.fp_id)
for c in ["name", "pos", "capital", "school", "conf", "conf_tier", "college_level", "draft_pick", "draft_round", "rookie_season"]:
    S[c] = S.player_id.map(PH[c])
bd = S.player_id.map(PH.birth_date)
S["age_start"] = (S.start - bd).dt.days / 365.25
S["age_end"] = (S.end.fillna(NOW) - bd).dt.days / 365.25
S["nfl_year_at_start"] = S.start.dt.year - S.rookie_season + (S.start.dt.month >= 8).astype(int)
out = []
for r in S.itertuples():
    end = r.end if pd.notna(r.end) else NOW
    v0, rk0 = pv(r.fp_id, r.start, r.sf), prank(r.fp_id, r.start, r.sf)
    v1 = pv(r.fp_id, end, r.sf)
    vmax_in, rbest_in = window_max(r.fp_id, r.start, end, r.sf)
    vmax_after_add, rbest_after_add = window_max(r.fp_id, r.start, r.start + pd.Timedelta(days=365), r.sf)
    if pd.notna(r.end):
        vmax_after_exit, rbest_after_exit = window_max(r.fp_id, r.end + pd.Timedelta(days=1), r.end + pd.Timedelta(days=365), r.sf)
        full_year_after = (r.end + pd.Timedelta(days=365)) <= NOW
    else:
        vmax_after_exit, rbest_after_exit, full_year_after = np.nan, np.nan, False
    rk1 = prank(r.fp_id, end, r.sf)
    out.append((v0, rk0, v1, rk1, vmax_in, rbest_in, vmax_after_add, rbest_after_add, vmax_after_exit, rbest_after_exit, full_year_after, pv(r.fp_id, NOW, r.sf), prank(r.fp_id, NOW, r.sf)))
S[["v_start", "rank_start", "v_end", "rank_end", "v_max_held", "rank_best_held", "v_max_12m_after_add", "rank_best_12m_after_add", "v_max_12m_after_exit",
   "rank_best_12m_after_exit", "full_year_after_exit", "v_now", "rank_now"]] = pd.DataFrame(out, index=S.index)
# started points during the stint
Wi = W.set_index(["league", "roster_id", "player_id"]).sort_index()
pts, starts, weeks_on = [], [], []
for r in S.itertuples():
    key = (r.league, r.roster_id, r.player_id)
    if key in Wi.index:
        w = Wi.loc[[key]]; end = r.end if pd.notna(r.end) else NOW
        w = w[(w.date >= r.start) & (w.date <= end)]
        pts.append(float(w[w.started].points.sum())); starts.append(int(w.started.sum())); weeks_on.append(len(w))
    else:
        pts.append(0.0); starts.append(0); weeks_on.append(0)
S["started_points"] = pts; S["starts"] = starts; S["weeks_rostered_inseason"] = weeks_on
S.to_parquet(os.path.join(OUT, "stints_enriched.parquet"))
print("stints enriched:", len(S), "| value coverage (fp_id):", f"{S.fp_id.notna().mean():.1%}", "| Brett started points total:", round(S[S.is_me].started_points.sum()))
print("DP rank->value check (2QB, latest):", {k: int(np.sort(V2[-1])[::-1][k - 1]) for k in [50, 100, 150, 200, 250, 300]})
