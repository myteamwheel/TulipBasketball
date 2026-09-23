"""Extra history for the ownership analysis: draft objects (slot -> roster), weekly matchups (lineups + points),
and monthly DynastyProcess combined values (players + picks)."""
import json, os, urllib.request
from concurrent.futures import ThreadPoolExecutor
from common import *
H = os.path.join(RAW, "sleeper", "history")
chains = json.load(open(os.path.join(H, "_chains.json")))
jobs = []
for label, chain in chains.items():
    for season, lid in chain:
        for d in json.load(open(os.path.join(H, lid, "drafts.json"))):
            jobs.append((f"https://api.sleeper.app/v1/draft/{d['draft_id']}", os.path.join(H, lid, f"draft_{d['draft_id']}.json"), False))
        last_week = 18
        for wk in range(1, last_week + 1):
            jobs.append((f"https://api.sleeper.app/v1/league/{lid}/matchups/{wk}", os.path.join(H, lid, f"matchups_{wk:02d}.json"), season == "2026"))
def run(j):
    url, path, refresh = j
    try:
        d = get_json(url, path, refresh=refresh, sleep=0.1); return len(d) if isinstance(d, list) else 1
    except Exception as e:
        raise RuntimeError(f"Required history fetch failed: {url}") from e
with ThreadPoolExecutor(4) as ex:
    res = list(ex.map(run, jobs))
print(len(jobs), "calls;", sum(r for r in res if isinstance(r, int)), "records;", [r for r in res if isinstance(r, str)][:5])

# monthly DP combined values (players + picks), from the repo history
M = os.path.join(RAW, "market", "dp_values_history"); os.makedirs(M, exist_ok=True)
commits = []
for page in range(1, 8):
    batch = get_json(f"https://api.github.com/repos/dynastyprocess/data/commits?path=files/values.csv&per_page=100&page={page}", os.path.join(M, f"_commits_p{page}.json"))
    if not batch: break
    commits += [(c["commit"]["author"]["date"][:10], c["sha"]) for c in batch]
by_month = {}
for d, sha in sorted(commits): by_month[d[:7]] = (d, sha)
keep = [x for x in sorted(by_month.values()) if x[0] >= "2020-05"]
for d, sha in keep:
    p = os.path.join(M, f"dpv_{d}.csv")
    if not os.path.exists(p):
        urllib.request.urlretrieve(f"https://raw.githubusercontent.com/dynastyprocess/data/{sha}/files/values.csv", p)
print(len(commits), "commits;", len(keep), "monthly snapshots", keep[0][0], "->", keep[-1][0])
