"""Shared config for the dynasty portfolio analysis."""
import json, os, time, urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = os.environ["AUDIT_WORK_DIR"]
AS_OF_TIMESTAMP = os.environ["AUDIT_AS_OF"]
AS_OF_DATE = AS_OF_TIMESTAMP[:10]
RAW = os.environ.get("AUDIT_RAW_DIR", os.path.join(ROOT, "raw"))
OUT = os.path.join(ROOT, "out")
BRETT_RAW = os.environ.get("AUDIT_REFERENCE_DIR", os.path.join(ROOT, "reference"))      # cached nflverse files (read-only)
ME = "819373914194067456"                                    # Sleeper user BrettTulip

LEAGUES = [  # (short label, league id, format tags)
    ("Dynasty Bois",   "1312155271526625280", dict(teams=12, sf=True,  ppr=0.5, tep=0.0, pass_td=4)),
    ("NOWL",           "1313957829895290880", dict(teams=32, sf=False, ppr=1.0, tep=1.0, pass_td=4)),
    ("Awesome",        "1312083478682021888", dict(teams=10, sf=True,  ppr=1.0, tep=0.0, pass_td=4)),
    ("Brokeback",      "1312084673609879552", dict(teams=12, sf=True,  ppr=1.0, tep=0.0, pass_td=4)),
    ("Big Show",       "1314742424395866112", dict(teams=32, sf=False, ppr=1.0, tep=0.5, pass_td=6)),
    ("DynastyMaxxing", "1359993203574464512", dict(teams=10, sf=True,  ppr=1.0, tep=0.5, pass_td=4)),
]

REPORTS = [  # (key, title, published artifact)
    ("audit", "Dynasty Audit", "https://claude.ai/artifact/K9YEGMGppyJyfvxkQkZkx9"),
    ("history", "Ownership History", "https://claude.ai/artifact/Nx5SByhcXURxg6PKWmcyPG"),
    ("combine", "Combine Profile", "https://claude.ai/artifact/Vhb2RT1PXZDnTFPXKpwKpY"),
    ("ledger", "Trade Ledger", "https://claude.ai/artifact/MrgHjb6LRRNdrk3pU7jw69"),
    ("playbook", "Trade Playbook", "https://claude.ai/artifact/9VZ2MapLffUc8Y5ikzset8"),
    ("timeline", "Strategy Timeline", "https://claude.ai/artifact/UCcNcqHNFnUc9JPnoDepLa"),
    ("bois", "Dynasty Bois Report", "https://claude.ai/artifact/KjucNLVom7Ci4wXc8K5z7E"),
    ("fhp", "Free Hot Pot Report", "https://claude.ai/artifact/X4Nw7FA47TqMXpGUnMNymK"),   # one league-mate (jtucker21), linked from the Bois report only
]
SIDE = {"fhp"}                                           # single-manager reports: not in every report's header

def report_links(exclude, extra=()):
    """' · '-separated links to the other published reports (side reports only when named in `extra`)"""
    return " · ".join(f'<a href="{u}" target="_blank" rel="noopener">{t}</a>' for k, t, u in REPORTS if k != exclude and u and (k not in SIDE or k in extra))

def report_url(key):
    return dict((k, u) for k, _, u in REPORTS)[key] or "#"

def get_json(url, path=None, refresh=False, sleep=0.05):
    """Fetch JSON (cached to `path` when given)."""
    if path and os.path.basename(path).startswith("_commits_p"): refresh = True
    if path and os.path.exists(path) and not refresh:
        return json.load(open(path))
    req = urllib.request.Request(url, headers={"User-Agent": "dynasty-bois-audit", **({"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"]} if url.startswith("https://api.github.com/") and os.environ.get("GITHUB_TOKEN") else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode())
    if path:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(data, open(path, "w"))
    time.sleep(sleep)
    return data
