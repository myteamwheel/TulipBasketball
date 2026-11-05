import { readFile, writeFile } from 'node:fs/promises';

const base = 'https://api.statsguyfantasy.com/api/v1';
const history = JSON.parse(await readFile('src/data/league-history.json', 'utf8'));
const trades = history.seasons.flatMap(season => season.trades);
const historical = {};
const jobs = [];
for (const trade of trades) {
  const date = new Date(trade.created - 86400000).toISOString().slice(0, 10);
  if (date < '2022-08-01') continue;
  const ids = [...new Set([...Object.keys(trade.adds ?? {}), ...trade.draft_picks.map(pick => `pick:${pick.season}:${pick.round}`)])];
  for (let start = 0; start < ids.length; start += 20) {
    const sideA = ids.slice(start, start + 20);
    jobs.push({ tradeId: trade.transaction_id, date, sideA });
  }
}
async function request(path, options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(60000) });
    if (response.ok) return response.json();
    if (response.status !== 429 && response.status < 500) throw new Error(`Stats Guy ${response.status}: ${await response.text()}`);
    await new Promise(resolve => setTimeout(resolve, Math.max(2, Number(response.headers.get('Retry-After')) || 2) * 1000));
  }
  throw new Error('Stats Guy API unavailable after retries');
}
for (let offset = 0; offset < jobs.length; offset += 25) {
  const batch = jobs.slice(offset, offset + 25);
  // Only public asset IDs and prior calendar dates go to the provider.
  const requests = batch.map(({ date, sideA }) => ({ format: 'sf_dynasty', tep: 'std', date, sideA, sideB: [sideA[0]] }));
  const response = await request('/trades/evaluate/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trades: requests }) });
  if (response.results?.length !== batch.length) throw new Error('Unexpected batch result length');
  for (const [index, job] of batch.entries()) {
    const row = response.results[index];
    if (row.date !== job.date || row.format !== 'sf_dynasty' || row.tep !== 'std') throw new Error('Unexpected historical response format or date');
    const quotes = historical[job.tradeId] ??= { date: job.date, values: {} };
    for (const asset of row.sideA.assets) {
      if (!job.sideA.includes(asset.id) || !asset.found || asset.asOf?.slice(0,10) !== job.date || !Number.isFinite(asset.value) || asset.value <= 0) continue;
      quotes.values[asset.id] = asset.value;
    }
  }
  console.log(`Checked ${offset + batch.length}/${jobs.length} dated requests`);
}
await writeFile('src/data/statsguy-historical-trades.json', JSON.stringify(historical));
console.log('Trades with a Stats Guy historical observation:', Object.values(historical).filter(row => Object.keys(row.values).length).length);
