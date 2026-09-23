"""Walk each league's previous_league_id chain; cache drafts, picks and every transaction."""
import json, os
from concurrent.futures import ThreadPoolExecutor
from common import *

H = os.path.join(RAW, "sleeper", "history")
jobs, chains = [], {}
for label, lid, fmt in LEAGUES:
    chain, cur = [], lid
    while cur and cur != "0":
        L = get_json(f"https://api.sleeper.app/v1/league/{cur}", os.path.join(H, cur, "league.json"), refresh=(cur == lid))
        get_json(f"https://api.sleeper.app/v1/league/{cur}/users", os.path.join(H, cur, "users.json"), refresh=(cur == lid))
        get_json(f"https://api.sleeper.app/v1/league/{cur}/rosters", os.path.join(H, cur, "rosters.json"), refresh=(cur == lid))
        chain.append((L["season"], cur))
        for d in get_json(f"https://api.sleeper.app/v1/league/{cur}/drafts", os.path.join(H, cur, "drafts.json"), refresh=(cur == lid)):
            jobs.append((f"https://api.sleeper.app/v1/draft/{d['draft_id']}/picks", os.path.join(H, cur, f"draftpicks_{d['draft_id']}.json"), cur == lid))
        for wk in range(0, 22):
            jobs.append((f"https://api.sleeper.app/v1/league/{cur}/transactions/{wk}", os.path.join(H, cur, f"tx_{wk:02d}.json"), cur == lid))
        cur = L.get("previous_league_id")
    chains[label] = chain
    print(label, "->", chain)
json.dump(chains, open(os.path.join(H, "_chains.json"), "w"), indent=1)

def run(j):
    url, path, refresh = j
    return len(get_json(url, path, refresh=refresh, sleep=0.1))
with ThreadPoolExecutor(4) as ex:
    n = list(ex.map(run, jobs))
print(f"{len(jobs)} endpoint calls, {sum(n)} records cached")
