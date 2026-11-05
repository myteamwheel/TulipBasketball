/** Player-specific reports are checked alongside current team and market data. */
const retiredSources: Record<string, string> = {
  '167': 'https://www.nfl.com/_amp/tom-brady-reveals-he-previously-looked-into-potential-nfl-comeback',
  '24': 'https://www.nfl.com/news/longtime-falcons-qb-matt-ryan-officially-retires-from-nfl-after-playing-15-seasons',
};

export function verifiedRetirement(sleeperId: string, nflTeam: string | null | undefined): string | undefined {
  return nflTeam ? undefined : retiredSources[sleeperId];
}
