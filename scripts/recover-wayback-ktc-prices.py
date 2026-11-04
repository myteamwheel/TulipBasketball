"""Recover prior-day KTC quotes from saved Internet Archive captures.

Usage: python3 scripts/recover-wayback-ktc-prices.py DIRECTORY_OF_CAPTURES
Save rankings and history captures as dynasty-rankings-YYYYMMDDhhmmss and
histories-YYYYMMDDhhmmss. The archive sometimes returns gzipped bodies.
"""
import collections
import datetime as dt
import gzip
import json
import re
import sys
from pathlib import Path

BASE = 'https://web.archive.org/web/'
SITE = 'https://keeptradecut.com/dynasty-rankings'
FALLBACKS = {'ARCHIVED_KTC_PRE_TRADE', 'ARCHIVED_KTC_POST_TRADE'}


def decode(path):
    body = path.read_bytes()
    return (gzip.decompress(body) if body.startswith(b'\x1f\x8b') else body).decode()


def rankings(html):
    embedded = re.search(r'<script[^>]+id="ktc-players"[^>]*>(.*?)</script>', html, re.S)
    if embedded:
        return json.loads(embedded[1])
    inline = re.search(r'var\s+playersArray\s*=\s*\[', html)
    return json.JSONDecoder().raw_decode(html[inline.end() - 1:])[0] if inline else []


def main(directory):
    identities = collections.defaultdict(set)
    observations = collections.defaultdict(lambda: collections.defaultdict(set))
    for path in sorted(directory.glob('dynasty-rankings-*')):
        for row in rankings(decode(path)):
            if row.get('position') == 'RDP':
                identities[row['playerID']].add(row['playerName'])
    for path in sorted(directory.glob('histories-*')):
        timestamp = path.name.removeprefix('histories-')
        capture_date = dt.datetime.strptime(timestamp, '%Y%m%d%H%M%S').date().isoformat()
        source = f'{BASE}{timestamp}id_/{SITE}/histories'
        for row in json.loads(decode(path)):
            names = identities.get(row['playerID'], set())
            if len(names) != 1:
                continue
            name = next(iter(names))
            if row.get('playerName', name) != name:
                continue
            history = row.get('superflex', {}).get('valueHistory') or row.get('superflexValues', {}).get('history', [])
            for entry in history:
                if isinstance(entry, str) and re.fullmatch(r'\d{7,10}', entry):
                    date = f'20{entry[:2]}-{entry[2:4]}-{entry[4:6]}'
                    value = int(entry[6:])
                elif isinstance(entry, dict):
                    date, value = entry.get('d'), entry.get('v')
                else:
                    continue
                if isinstance(date, str) and re.fullmatch(r'\d{4}-\d\d-\d\d', date) and date < capture_date and type(value) is int and 0 < value <= 9999:
                    observations[(name, date)][value].add(source)

    ledger = json.loads(Path('src/data/league-history.json').read_text())
    path = Path('src/data/trade-chart-prices.json')
    archive = json.loads(path.read_text())
    added = upgraded = 0
    for season in ledger['seasons']:
        for trade in season['trades']:
            prior = (dt.datetime.fromtimestamp(trade['created'] / 1000, dt.timezone.utc).date() - dt.timedelta(days=1)).isoformat()
            for pick in trade['draft_picks']:
                year, round_number, roster = pick['season'], pick['round'], pick['roster_id']
                ordinal = {1: '1st', 2: '2nd', 3: '3rd', 4: '4th'}.get(round_number)
                key = f'pick:{year}:{round_number}:{roster}'
                trade_prices = archive['prices'].get(trade['transaction_id'], {})
                previous = trade_prices.get(key)
                if not ordinal or (previous and previous['method'] not in FALLBACKS):
                    continue
                buckets = [observations.get((f'{year} {bucket} {ordinal}', prior), {}) for bucket in ('Early', 'Mid', 'Late')]
                if any(len(bucket) != 1 for bucket in buckets):
                    continue
                values = [next(iter(bucket)) for bucket in buckets]
                sources = set.intersection(*(bucket[value] for bucket, value in zip(buckets, values)))
                if not sources:
                    continue
                archive['prices'].setdefault(trade['transaction_id'], {})[key] = {
                    'value': (sum(values) + 1) // 3,
                    'date': prior,
                    'method': 'ARCHIVED_KTC_ROUND_AVERAGE',
                    'sourceUrls': [sorted(sources)[0]],
                }
                if previous:
                    upgraded += 1
                else:
                    added += 1
    if added or upgraded:
        archive['fetchedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        path.write_text(json.dumps(archive, separators=(',', ':')))
    print(f'Checked {len(observations)} pick/date series entries. Added {added} prices, upgraded {upgraded} estimates.')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
