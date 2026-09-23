"""Pull the live league/users/rosters for all six leagues and verify them."""
import json, os, sys, datetime
from common import *

stamp = datetime.now().strftime("%Y-%m-%dT%H%M")
base = os.path.join(RAW, "sleeper", "current")
for label, lid, fmt in LEAGUES:
    for ep in ("", "/users", "/rosters", "/traded_picks", "/drafts"):
        name = (ep.strip("/") or "league")
        get_json(f"https://api.sleeper.app/v1/league/{lid}{ep}", os.path.join(base, f"{name}_{lid}.json"), refresh=True)
json.dump({"pulled_at": datetime.now().isoformat(timespec="seconds")}, open(os.path.join(base, "_pulled_at.json"), "w"))

# verification against the snapshot taken earlier in this session (if supplied)
prev_dir = sys.argv[1] if len(sys.argv) > 1 else None
for label, lid, fmt in LEAGUES:
    L = json.load(open(os.path.join(base, f"league_{lid}.json")))
    U = {u["user_id"]: u for u in json.load(open(os.path.join(base, f"users_{lid}.json")))}
    R = json.load(open(os.path.join(base, f"rosters_{lid}.json")))
    me = next(r for r in R if r.get("owner_id") == ME)
    sc, rp = L["scoring_settings"], L["roster_positions"]
    got = dict(teams=L["total_rosters"], sf="SUPER_FLEX" in rp, ppr=sc.get("rec"), tep=sc.get("bonus_rec_te", 0.0) or 0.0, pass_td=sc.get("pass_td"))
    ok = all(got[k] == fmt[k] for k in fmt)
    team = ((U[ME].get("metadata") or {}).get("team_name") or U[ME]["display_name"]).strip()
    line = f"{label:15s} season={L['season']} status={L['status']} team={team!r} players={len(me['players'])} format_ok={ok} commish={bool(U[ME].get('is_owner'))}"
    if prev_dir:
        old = next(r for r in json.load(open(os.path.join(prev_dir, f"rosters_{lid}.json"))) if r.get("owner_id") == ME)
        add, drop = set(me["players"]) - set(old["players"]), set(old["players"]) - set(me["players"])
        line += f" | vs earlier pull: +{len(add)} -{len(drop)} {sorted(add)} {sorted(drop)}"
    print(line)
    if not ok: print("   format mismatch:", got, "expected", fmt)
