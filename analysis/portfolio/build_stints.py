"""Replay every league's full history (drafts + transactions) to reconstruct ownership stints for every roster,
split by manager when a franchise changes hands, and validate against Sleeper's end-of-season and current rosters."""
import json, os, glob
import numpy as np, pandas as pd
from common import *

H = os.path.join(RAW, "sleeper", "history")
chains = json.load(open(os.path.join(H, "_chains.json")))
NOW = pd.Timestamp(AS_OF_TIMESTAMP).value // 10**6
stints, trades, picks_out, failed, validation = [], [], [], [], []

for label, chain in chains.items():
    chain = sorted(chain)                                 # oldest season first
    owner = {}                                            # (season, roster_id) -> owner user id
    for season, lid in chain:
        for r in json.load(open(os.path.join(H, lid, "rosters.json"))):
            owner[(int(season), r["roster_id"])] = r.get("owner_id")
    ev = []
    for season, lid in chain:
        s = int(season)
        for d in json.load(open(os.path.join(H, lid, "drafts.json"))):
            if d.get("status") != "complete": continue
            full = json.load(open(os.path.join(H, lid, f"draft_{d['draft_id']}.json")))
            rounds = (d.get("settings") or {}).get("rounds", 0)
            kind = "Startup draft" if (s == int(chain[0][0]) and rounds >= 10) else "Rookie draft"
            t0 = d.get("start_time") or 0
            for p in json.load(open(os.path.join(H, lid, f"draftpicks_{d['draft_id']}.json"))):
                if not p.get("player_id"): continue
                ev.append(dict(ts=t0 + p["pick_no"], season=s, kind="draft", method=kind, adds={str(p["player_id"]): p["roster_id"]}, drops={},
                               info=dict(round=p.get("round"), pick_no=p.get("pick_no"), draft_slot=p.get("draft_slot"), draft_id=d["draft_id"],
                                         amount=pd.to_numeric((p.get("metadata") or {}).get("amount"), errors="coerce"),
                                         slot_to_roster=full.get("slot_to_roster_id"), n_teams=(d.get("settings") or {}).get("teams"))))
        seen = set()
        for f in sorted(glob.glob(os.path.join(H, lid, "tx_*.json"))):
            for t in json.load(open(f)):
                if t["transaction_id"] in seen: continue
                seen.add(t["transaction_id"])
                if t.get("status") == "failed" and t["type"] == "waiver":
                    for pid, rid in (t.get("adds") or {}).items():
                        failed.append(dict(league=label, season=s, roster_id=rid, owner=owner.get((s, rid)), player_id=str(pid), ts=t.get("status_updated") or t["created"],
                                           bid=(t.get("settings") or {}).get("waiver_bid"), note=(t.get("metadata") or {}).get("notes")))
                    continue
                if t.get("status") != "complete": continue
                m = {"trade": "Trade", "waiver": "Waiver claim", "free_agent": "Free-agent add", "commissioner": "Commissioner"}[t["type"]]
                ev.append(dict(ts=t.get("status_updated") or t["created"], season=s, kind=t["type"], method=m, adds={str(k): v for k, v in (t.get("adds") or {}).items()},
                               drops={str(k): v for k, v in (t.get("drops") or {}).items()}, info=dict(tid=t["transaction_id"], bid=(t.get("settings") or {}).get("waiver_bid"),
                               picks=t.get("draft_picks") or [], faab=t.get("waiver_budget") or [], roster_ids=t.get("roster_ids") or [])))
    ev.sort(key=lambda e: (e["ts"], 0 if e["kind"] != "trade" else 1))
    # season boundaries: first event timestamp of each season
    first_ts = {}
    for e in ev: first_ts.setdefault(e["season"], e["ts"])
    seasons = sorted({int(s) for s, _ in chain})
    def season_at(ts):
        cur = seasons[0]
        for s in seasons:
            if s in first_ts and ts >= first_ts[s]: cur = s
        return cur

    held = {}                                             # player -> open stint dict
    def close(pid, ts, how, info=None):
        st = held.pop(pid, None)
        if st:
            st.update(end_ts=ts, end_method=how, end_season=season_at(ts), end_info=info or {}); stints.append(st)
    def open_(pid, rid, ts, method, info, season):
        held[pid] = dict(league=label, roster_id=rid, player_id=pid, start_ts=ts, start_method=method, start_season=season, start_info=info,
                         owner=owner.get((season, rid)))
    def reconcile(final, ts, season):
        # force the replay to agree with Sleeper's recorded rosters (moves Sleeper made without a transaction record)
        where = {pid: st["roster_id"] for pid, st in held.items()}
        for rid, players in final.items():
            for pid in players:
                if where.get(pid) == rid: continue
                if pid in held: close(pid, ts, "Unrecorded move")
                open_(pid, rid, ts, "Unrecorded add", {}, season)
        for pid, st in list(held.items()):
            if pid not in final.get(st["roster_id"], set()): close(pid, ts, "Unrecorded removal")
    # franchise hand-overs: at each season start, split stints whose roster owner changed
    boundary_done = set()
    def handover(ts):
        s = season_at(ts)
        if s in boundary_done: return
        boundary_done.add(s)
        prev = max([x for x in seasons if x < s], default=None)
        if prev is None: return
        # validation: state at the boundary vs previous season's final rosters
        lid_prev = dict((int(a), b) for a, b in chain)[prev]
        final = {r["roster_id"]: set(r.get("players") or []) for r in json.load(open(os.path.join(H, lid_prev, "rosters.json")))}
        recon = {}
        for pid, st in held.items(): recon.setdefault(st["roster_id"], set()).add(pid)
        tot = sum(len(v) for v in final.values()); match = sum(len(final[r] & recon.get(r, set())) for r in final)
        extra = sum(len(recon.get(r, set()) - final[r]) for r in final)
        validation.append(dict(league=label, season=prev, final_players=tot, matched=match, extra_in_replay=extra))
        reconcile(final, ts - 1, prev)
        for pid, st in list(held.items()):
            new_owner = owner.get((s, st["roster_id"]))
            if new_owner != st["owner"]:
                rid = st["roster_id"]; close(pid, ts - 1, "Franchise changed hands"); open_(pid, rid, ts, "Inherited (took over team)", {}, s)
    for e in ev:
        handover(e["ts"])
        s = season_at(e["ts"])
        for pid, rid in e["drops"].items():
            if pid in held and held[pid]["roster_id"] == rid:
                how = {"trade": "Traded away", "waiver": "Dropped", "free_agent": "Dropped", "commissioner": "Removed by commissioner"}[e["kind"]]
                close(pid, e["ts"], how, e["info"] if e["kind"] == "trade" else {"tid": e["info"].get("tid")})
        for pid, rid in e["adds"].items():
            if pid in held:
                if held[pid]["roster_id"] == rid: continue       # already there (duplicate record)
                close(pid, e["ts"], "Moved without recorded drop")
            if rid is None: continue
            open_(pid, rid, e["ts"], e["method"], e["info"], s)
        if e["kind"] == "trade":
            trades.append(dict(league=label, season=s, ts=e["ts"], tid=e["info"]["tid"], roster_ids=e["info"]["roster_ids"], adds=e["adds"], drops=e["drops"],
                               picks=e["info"]["picks"], faab=e["info"]["faab"], owners={rid: owner.get((s, rid)) for rid in e["info"]["roster_ids"]}))
    # still rostered: validate against the current rosters
    handover(NOW)
    lid_now = dict((int(a), b) for a, b in chain)[seasons[-1]]
    final = {r["roster_id"]: set(r.get("players") or []) for r in json.load(open(os.path.join(RAW, "sleeper", "current", f"rosters_{lid_now}.json")))}
    recon = {}
    for pid, st in held.items(): recon.setdefault(st["roster_id"], set()).add(pid)
    tot = sum(len(v) for v in final.values()); match = sum(len(final[r] & recon.get(r, set())) for r in final)
    validation.append(dict(league=label, season=seasons[-1], final_players=tot, matched=match, extra_in_replay=sum(len(recon.get(r, set()) - final[r]) for r in final), current=True))
    reconcile(final, NOW - 1, seasons[-1])
    for pid, st in list(held.items()):
        st.update(end_ts=None, end_method="Still rostered", end_season=None, end_info={}); stints.append(st); held.pop(pid)

S = pd.DataFrame(stints)
S["start"] = pd.to_datetime(S.start_ts, unit="ms"); S["end"] = pd.to_datetime(S.end_ts, unit="ms")
S["days"] = ((S.end.fillna(pd.Timestamp(AS_OF_DATE)) - S.start).dt.total_seconds() / 86400).clip(lower=0)
S["is_me"] = S.owner == ME
S["stint_id"] = range(len(S))
jd = lambda o: json.dumps(o, default=lambda x: None if (isinstance(x, float) and np.isnan(x)) else (x.item() if hasattr(x, "item") else str(x)))
for c in ["start_info", "end_info"]: S[c] = S[c].map(jd, na_action="ignore")
S.to_parquet(os.path.join(OUT, "stints.parquet"))
T = pd.DataFrame(trades); T["adds"] = T.adds.map(json.dumps); T["drops"] = T.drops.map(json.dumps); T["picks"] = T.picks.map(json.dumps); T["faab"] = T.faab.map(json.dumps)
T["owners"] = T.owners.map(lambda d: json.dumps({str(k): v for k, v in d.items()})); T["roster_ids"] = T.roster_ids.map(json.dumps)
T.to_parquet(os.path.join(OUT, "trades.parquet"))
pd.DataFrame(failed).to_parquet(os.path.join(OUT, "failed_claims.parquet"))
V = pd.DataFrame(validation); V["match_rate"] = V.matched / V.final_players
print(V.to_string())
print("\nstints:", len(S), "| Brett:", int(S.is_me.sum()), "| start methods:", S[S.is_me].start_method.value_counts().to_dict())
print("end methods (Brett):", S[S.is_me].end_method.value_counts().to_dict())
print("anomalies:", S.end_method.eq("Moved without recorded drop").sum(), "moves without drops (all rosters)")
print("trades:", len(T), "| failed claims:", len(failed))
