export function projectionSummary(current: { playerId: string }[], unavailable: { playerId: string }[], history: { absoluteError: number | null; signedError: number | null }[]) {
  const projected = new Set(current.map(row => row.playerId));
  const graded = history.filter(row => row.absoluteError !== null && row.signedError !== null);
  return {
    withheld: unavailable.filter(row => !projected.has(row.playerId)).length,
    graded: graded.length,
    mae: graded.length ? graded.reduce((sum, row) => sum + row.absoluteError!, 0) / graded.length : null,
    bias: graded.length ? graded.reduce((sum, row) => sum + row.signedError!, 0) / graded.length : null,
    withinFive: graded.length ? graded.filter(row => row.absoluteError! <= 5).length / graded.length * 100 : null,
  };
}
