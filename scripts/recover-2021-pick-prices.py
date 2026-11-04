"""Import only prior-date Superflex quotes from the published Dynasty Daddy CSV.
Source schema: back-end/database/scripts/0-create_ktc_players_table.sql.
Usage: python3 scripts/recover-2021-pick-prices.py downloaded-datasource.csv
"""
import csv
import datetime
import json
import sys
from pathlib import Path

source = 'https://github.com/G-Sher/dynasty-daddy/blob/main/data/datasource.csv'
rows = list(csv.reader(open(sys.argv[1])))
quotes = {}
for row in sorted(rows, key=lambda row: row[13]):
    if row[7] == 'PI':
        quotes[(row[13][:10], row[3])] = int(row[11])
history = json.loads(Path('src/data/league-history.json').read_text())
path = Path('src/data/trade-chart-prices.json')
result = json.loads(path.read_text())
added = 0
for season in history['seasons']:
    for trade in season['trades']:
        date = (datetime.datetime.fromtimestamp(trade['created'] / 1000, datetime.timezone.utc) - datetime.timedelta(days=1)).date().isoformat()
        for pick in trade['draft_picks']:
            ordinal = {1: '1st', 2: '2nd', 3: '3rd', 4: '4th'}.get(pick['round'])
            values = [quotes.get((date, f"{pick['season']} {bucket} {ordinal}")) for bucket in ['Early', 'Mid', 'Late']]
            if not all(value and 0 < value <= 9999 for value in values):
                continue
            key = f"pick:{pick['season']}:{pick['round']}:{pick['roster_id']}"
            prices = result['prices'].setdefault(trade['transaction_id'], {})
            if key not in prices:
                prices[key] = dict(value=round(sum(values) / 3), date=date, method='ARCHIVED_KTC_ROUND_AVERAGE', sourceUrls=[source])
                added += 1
path.write_text(json.dumps(result, separators=(',', ':')))
print(json.dumps(dict(addedPickPrices=added)))
