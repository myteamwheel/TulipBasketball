"""Match public Next Level Dynasty Football KTC boards to missing trade picks.

Usage: python3 scripts/recover-archived-ktc-boards.py DIRECTORY_OF_BOARDS
Only accept a pre-trade capture at most seven days old and complete round buckets.
"""
import datetime as dt
import json
import sys
from pathlib import Path

ARCHIVE_URL = 'https://github.com/pstiehl/Dynasty-Football-Model/blob/main/data/consensus/history/'
MAX_AGE = dt.timedelta(days=7)


def main(board_dir: Path):
    boards = []
    for file in board_dir.glob('ktc_values_*.json'):
        board = json.loads(file.read_text())
        if board.get('schema') != 'ktc.values.v1' or not board.get('picks'):
            continue
        captured_at = dt.datetime.fromisoformat(board['captured_at'])
        if captured_at.tzinfo is None or file.name != f'ktc_values_{captured_at.date()}.json':
            continue
        boards.append((captured_at, file.name, board['picks']))
    boards.sort(key=lambda board: board[0], reverse=True)

    ledger = json.loads(Path('src/data/league-history.json').read_text())
    path = Path('src/data/trade-chart-prices.json')
    archive = json.loads(path.read_text())
    prices = archive['prices']
    added = 0
    for season in ledger['seasons']:
        for trade in season['trades']:
            traded_at = dt.datetime.fromtimestamp(trade['created'] / 1000, dt.timezone.utc)
            preceding = [board for board in boards if dt.timedelta(0) <= traded_at - board[0] <= MAX_AGE]
            for pick in trade['draft_picks']:
                year, round_number, roster = pick['season'], pick['round'], pick['roster_id']
                key = f'pick:{year}:{round_number}:{roster}'
                ordinal = {1: '1st', 2: '2nd', 3: '3rd', 4: '4th'}.get(round_number)
                if not ordinal or key in prices.get(trade['transaction_id'], {}):
                    continue
                for captured_at, filename, values in preceding:
                    buckets = [values.get(f'{year} {bucket} {ordinal}') for bucket in ('Early', 'Mid', 'Late')]
                    if not all(type(value) is int and 0 < value <= 9999 for value in buckets):
                        continue
                    prices.setdefault(trade['transaction_id'], {})[key] = {
                        'value': (sum(buckets) + 1) // 3,
                        'date': captured_at.date().isoformat(),
                        'observedAt': captured_at.isoformat(),
                        'method': 'ARCHIVED_KTC_PRE_TRADE',
                        'sourceUrls': [ARCHIVE_URL + filename],
                    }
                    added += 1
                    break
    if added:
        archive['fetchedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        path.write_text(json.dumps(archive, separators=(',', ':')))
    print(f'Checked {len(boards)} dated boards and recovered {added} pick prices')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
