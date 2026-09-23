"""Step 3: every add event (drafts, trades, waivers, FA) across each league's full history;
acquisition record for every current roster spot; transaction-activity summary."""
import json, os, glob
import numpy as np, pandas as pd
from common import *

H = os.path.join(RAW, "sleeper", "history")
chains = json.load(open(os.path.join(H, "_chains.json")))
events, owners, activity = [], [], []
for label, chain in chains.items():
    first_season = min(int(s) for s, _ in chain)
    for season, lid in chain:
        D = os.path.join(H, lid)
        for r in json.load(open(os.path.join(D, "rosters.json"))):
            owners.append(dict(league=label, season=int(season), roster_id=r["roster_id"], owner_id=r.get("owner_id")))
        # drafts
        for d in json.load(open(os.path.join(D, "drafts.json"))):
            picks = json.load(open(os.path.join(D, f"draftpicks_{d['draft_id']}.json")))
            rounds = (d.get("settings") or {}).get("rounds", 0)
            kind = "Startup draft" if (int(season) == first_season and rounds >= 10) else "Rookie draft"
            t0 = d.get("start_time") or d.get("last_picked") or 0
            for p in picks:
                if not p.get("player_id"): continue
                events.append(dict(league=label, season=int(season), ts=t0 + p["pick_no"], method=kind, roster_id=p.get("roster_id"),
                                   user_id=p.get("picked_by"), player_id=str(p["player_id"]), round=p.get("round"), pick_no=p.get("pick_no"),
                                   auction_amount=pd.to_numeric((p.get("metadata") or {}).get("amount"), errors="coerce"), draft_type=d.get("type")))
        # transactions
        seen = set()
        for f in sorted(glob.glob(os.path.join(D, "tx_*.json"))):
            for t in json.load(open(f)):
                if t.get("status") != "complete" or t["transaction_id"] in seen: continue
                seen.add(t["transaction_id"])
                ts = t.get("status_updated") or t.get("created")
                typ = {"trade": "Trade", "waiver": "Waiver claim", "free_agent": "Free-agent add", "commissioner": "Commissioner move"}.get(t["type"], t["type"])
                for rid in t.get("roster_ids") or []:
                    activity.append(dict(league=label, season=int(season), roster_id=rid, type=typ, ts=ts, tid=t["transaction_id"]))
                for pid, rid in (t.get("adds") or {}).items():
                    sent = [p for p, r in (t.get("drops") or {}).items() if r == rid] if t["type"] == "trade" else []
                    picks_sent = [f"{x['season']} R{x['round']}" for x in (t.get("draft_picks") or []) if x.get("previous_owner_id") == rid]
                    events.append(dict(league=label, season=int(season), ts=ts, method=typ, roster_id=rid, user_id=None, player_id=str(pid),
                                       faab=(t.get("settings") or {}).get("waiver_bid"), tid=t["transaction_id"],
                                       trade_players_sent=len(sent), trade_picks_sent=len(picks_sent), trade_sent="; ".join(picks_sent)))
E = pd.DataFrame(events).sort_values("ts").reset_index(drop=True)
O = pd.DataFrame(owners)
A = pd.DataFrame(activity)
E["date"] = pd.to_datetime(E.ts, unit="ms").dt.normalize()
# who owned the receiving roster at the time (roster ids persist across renewals)
E = E.merge(O.rename(columns={"owner_id": "roster_owner"}), on=["league", "season", "roster_id"], how="left")
E.to_parquet(os.path.join(OUT, "add_events.parquet"))

spots = pd.read_parquet(os.path.join(OUT, "roster_spots.parquet"))
last = E.groupby(["league", "roster_id", "player_id"]).tail(1).set_index(["league", "roster_id", "player_id"])
acq = spots.join(last[["season", "date", "method", "round", "pick_no", "auction_amount", "faab", "trade_players_sent", "trade_picks_sent", "trade_sent", "roster_owner"]],
                 on=["league", "roster_id", "sleeper_id"])
acq["method"] = acq.method.fillna("Unknown (no add event)")
acq.loc[acq.roster_owner.notna() & (acq.roster_owner != acq.owner_id), "method"] = "Inherited (prior manager)"
acq["days_held"] = (pd.Timestamp(AS_OF_DATE) - acq.date).dt.days
acq.rename(columns={"season": "acq_season", "date": "acq_date"}).to_parquet(os.path.join(OUT, "acquisitions.parquet"))

# Brett's roster id each season (checks he has held the same franchise throughout)
me = O[O.owner_id == ME].groupby("league").agg(seasons=("season", lambda s: sorted(s)), roster_ids=("roster_id", lambda s: sorted(set(s))))
print(me.to_string())
print("\nacquisition method, Brett vs league-mates (share of current roster spots):")
tab = pd.crosstab(acq.method, acq.is_me, normalize="columns").round(3)
tab.columns = ["league-mates", "Brett"]; print(tab.to_string())
A.to_parquet(os.path.join(OUT, "tx_activity.parquet"))
print("\nevents:", len(E), "| trades involving Brett:", A[(A.type == "Trade")].merge(O, on=["league", "season", "roster_id"]).query("owner_id == @ME").tid.nunique())
