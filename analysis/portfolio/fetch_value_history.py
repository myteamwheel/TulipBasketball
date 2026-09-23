"""Monthly DynastyProcess value snapshots (FantasyPros-ECR-based, GPL-3.0 open data) from the repo's git history."""
import json, os, urllib.request
from common import *
M = os.path.join(RAW, "market", "dp_history"); os.makedirs(M, exist_ok=True)
commits = []
for page in range(1, 8):
    url = f"https://api.github.com/repos/dynastyprocess/data/commits?path=files/values-players.csv&per_page=100&page={page}"
    batch = get_json(url, os.path.join(M, f"_commits_p{page}.json"))
    if not batch: break
    commits += [(c["commit"]["author"]["date"][:10], c["sha"]) for c in batch]
commits.sort()
print(len(commits), "commits", commits[0][0], "->", commits[-1][0])
# keep the last commit of each month (plus the newest)
by_month = {}
for d, sha in commits: by_month[d[:7]] = (d, sha)
keep = sorted(by_month.values())
for d, sha in keep:
    path = os.path.join(M, f"dp_{d}.csv")
    if not os.path.exists(path):
        urllib.request.urlretrieve(f"https://raw.githubusercontent.com/dynastyprocess/data/{sha}/files/values-players.csv", path)
print(len(keep), "monthly snapshots:", keep[0][0], "...", keep[-1][0])
