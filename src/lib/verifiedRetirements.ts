/** Player-specific reports are checked alongside current team and market data. */
const retiredSources: Record<string, string> = {
  '167': 'https://www.nfl.com/_amp/tom-brady-reveals-he-previously-looked-into-potential-nfl-comeback',
  '24': 'https://www.nfl.com/news/longtime-falcons-qb-matt-ryan-officially-retires-from-nfl-after-playing-15-seasons',
  '1689': 'https://www.nfl.com/news/two-time-pro-bowl-wr-adam-thielen-retiring-from-nfl-after-13-seasons',
  '2028': 'https://www.nfl.com/news/saints-qb-derek-carr-to-retire-from-nfl-after-dealing-with-shoulder-injury',
  '2319': 'https://www.nfl.com/news/wide-receiver-devante-parker-announces-retirement-two-months-after-signing-with-eagles',
  '538': 'https://www.nfl.com/news/emmanuel-sanders-retirement-broncos-steelers-49ers-saints-bills',
};

export function verifiedRetirement(sleeperId: string, nflTeam: string | null | undefined): string | undefined {
  return nflTeam ? undefined : retiredSources[sleeperId];
}
