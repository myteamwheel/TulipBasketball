"""Recover missing trade values as dated DynastyProcess-to-KTC estimates.

Requires public DynastyProcess values.csv snapshots, git commit timestamps and
KTC daily history CSV. No same-day KTC prices enter a pre-trade calibration.
Usage: python3 scripts/recover-dynastyprocess-estimates.py SNAPSHOTS_DIR COMMITS KTC_CSV
"""
import collections
import csv
import datetime as dt
import json
import math
import re
import statistics
import sys
from pathlib import Path

SNAPSHOTS, COMMITS, KTC = map(Path, sys.argv[1:4])
HISTORY = json.loads(Path('src/data/league-history.json').read_text())
EXISTING = json.loads(Path('src/data/trade-chart-prices.json').read_text())['prices']
SHEET_URL = 'https://docs.google.com/spreadsheets/d/1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs/edit'
DP_URL = 'https://github.com/dynastyprocess/data/blob/{}/files/values.csv'


def key(value):
    return re.sub(r'[^a-z0-9]', '', re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', value.lower()))


def number(value):
    try:
        value = float(value.replace(',', ''))
        return value if math.isfinite(value) and value > 0 else None
    except (ValueError, AttributeError):
        return None


with KTC.open(newline='') as handle:
    reader = csv.reader(handle)
    header = next(reader)
    columns = collections.defaultdict(list)
    for index, name in enumerate(header[1:], 1):
        columns[key(name)].append(index)
    sheet = {row[0]: row for row in reader}
commits = []
for line in COMMITS.read_text().splitlines():
    timestamp, sha = line.split(' ', 1)
    observed = dt.datetime.fromisoformat(timestamp)
    if observed.tzinfo:
        commits.append((observed.timestamp() * 1000, sha, observed))
commits.sort(reverse=True)
boards = {}


def estimate(x, anchors):
    # Convert by local rank-neighbourhood, rather than a global multiplier:
    # the source and KTC have very different value curves.
    if not x or len(anchors) < 100:
        return None
    nearby = sorted(anchors, key=lambda a: abs(math.log((a[0] + 300) / (x + 300))))[:35]
    if len(nearby) < 35 or abs(math.log((nearby[0][0] + 300) / (x + 300))) > 0.35:
        return None
    return max(1, min(9999, round(statistics.median(y for _, y in nearby))))


def load_board(sha, commit_at):
    if sha in boards:
        return boards[sha]
    file = SNAPSHOTS / (sha + '.csv')
    if not file.exists():
        boards[sha] = None
        return None
    with file.open(newline='') as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        boards[sha] = None
        return None
    try:
        day = dt.date.fromisoformat(rows[0]['scrape_date'])
    except (ValueError, KeyError):
        boards[sha] = None
        return None
    if day > commit_at.astimezone(dt.timezone.utc).date() or (commit_at.astimezone(dt.timezone.utc).date() - day).days > 2:
        boards[sha] = None
        return None
    ktc = sheet.get((day - dt.timedelta(days=1)).isoformat())
    if not ktc:
        boards[sha] = None
        return None
    index = collections.defaultdict(list)
    anchors = []
    for row in rows:
        name, position = row.get('player', ''), row.get('pos', '')
        value = number(row.get('value_2qb'))
        if not name or not value:
            continue
        index[(key(name), position)].append(value)
        match = columns.get(key(name), [])
        if position in ('QB', 'RB', 'WR', 'TE') and len(match) == 1 and match[0] < len(ktc):
            comparison = number(ktc[match[0]])
            if comparison and comparison <= 9999:
                anchors.append((value, comparison))
    if len(anchors) < 100:
        boards[sha] = None
        return None
    # Reject dates where this source's ranking curve does not calibrate well.
    errors = []
    for fold in range(5):
        training = [row for i, row in enumerate(anchors) if i % 5 != fold]
        for i, (value, actual) in enumerate(anchors):
            if i % 5 == fold:
                predicted = estimate(value, training)
                if predicted is not None:
                    errors.append(abs(predicted - actual))
    typical_error = round(statistics.median(errors)) if errors else None
    if typical_error is None or typical_error > 600:
        boards[sha] = None
        return None
    boards[sha] = (day, index, anchors, typical_error)
    return boards[sha]


out = {}
for season in HISTORY['seasons']:
    for trade in season['trades']:
        match = next(((sha, observed) for timestamp, sha, observed in commits
                      if 0 <= trade['created'] - timestamp <= 7 * 86400000), None)
        if not match:
            continue
        sha, observed = match
        board = load_board(sha, observed)
        if not board:
            continue
        day, index, anchors, error = board
        already = EXISTING.get(trade['transaction_id'], {})
        assets = {}
        for sleeper_id in (trade.get('adds') or {}):
            asset_id = 'player:' + sleeper_id
            if asset_id in already:
                continue
            player = HISTORY['players'].get(sleeper_id)
            if not player:
                continue
            candidates = index.get((key(player['name']), player['position']), [])
            if len(candidates) == 1:
                assets[asset_id] = candidates[0]
        for pick in trade.get('draft_picks', []):
            asset_id = f"pick:{pick['season']}:{pick['round']}:{pick['roster_id']}"
            if asset_id in already:
                continue
            ordinal = {1:'1st', 2:'2nd', 3:'3rd', 4:'4th'}.get(pick['round'])
            if not ordinal:
                continue
            candidates = index.get((key(f"{pick['season']} {ordinal}"), 'PICK'), [])
            if len(candidates) == 1:
                assets[asset_id] = candidates[0]
        for asset_id, raw_value in assets.items():
            value = estimate(raw_value, anchors)
            if value is None:
                continue
            out.setdefault(trade['transaction_id'], {})[asset_id] = {
                'value': value, 'date': day.isoformat(), 'observedAt': observed.isoformat(),
                'method': 'DYNASTYPROCESS_ESTIMATE', 'sourceUrls': [DP_URL.format(sha), SHEET_URL],
                'originalValue': raw_value, 'calibrationSamples': len(anchors), 'typicalError': error,
            }
path = Path('src/data/dynastyprocess-historical-estimates.json')
path.write_text(json.dumps({'method': 'DynastyProcess 2QB values mapped to KTC using prior-day player anchors',
                            'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'prices': out}, separators=(',', ':')) + '\n')
print(json.dumps({'trades':len(out), 'assets':sum(map(len, out.values())), 'boards':sum(v is not None for v in boards.values())}))
