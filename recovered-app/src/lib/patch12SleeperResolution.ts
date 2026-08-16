export function unresolvedSleeperLabel(playerId: string | number | null | undefined) {
  const id = String(playerId ?? '').trim();
  return id ? `Sleeper ID ${id} · pending player-map refresh` : 'Unknown Sleeper asset · pending player-map refresh';
}

export async function fetchSleeperPlayerById(playerId: string | number) {
  const id = String(playerId).trim();
  if (!id) return null;
  const res = await fetch(`https://api.sleeper.app/v1/players/nfl/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json() as Promise<Record<string, unknown>>;
}
