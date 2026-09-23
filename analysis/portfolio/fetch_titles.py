"""Champion of every completed season (winners bracket), for context in the trader rankings."""
import json, os
from common import *
H = os.path.join(RAW, "sleeper", "history")
chains = json.load(open(os.path.join(H, "_chains.json")))
titles = []
for label, chain in chains.items():
    for season, lid in chain:
        if int(season) >= 2026: continue
        wb = get_json(f"https://api.sleeper.app/v1/league/{lid}/winners_bracket", os.path.join(H, lid, "winners_bracket.json"))
        owners = {r["roster_id"]: r.get("owner_id") for r in json.load(open(os.path.join(H, lid, "rosters.json")))}
        final = [m for m in (wb or []) if m.get("p") == 1]
        champ = final[0].get("w") if final else None
        titles.append(dict(league=label, season=int(season), champion_roster=champ, champion_owner=owners.get(champ)))
json.dump(titles, open(os.path.join(OUT, "titles.json"), "w"), indent=1)
for t in titles: print(t["league"], t["season"], t["champion_roster"], "Brett!" if t["champion_owner"] == ME else "")
