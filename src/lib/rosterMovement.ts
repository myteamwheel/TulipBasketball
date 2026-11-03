type Movement = { managerId: string; direction: 1 | -1; value: number | null; stale: boolean };

/** Value player additions and departures only when every affected price is usable. */
export function rosterMovement(movements: Movement[]): Map<string, number | null> {
  const totals = new Map<string, number | null>();
  for (const movement of movements) {
    if (totals.get(movement.managerId) === null) continue;
    if (movement.stale || movement.value === null || !Number.isFinite(movement.value) || movement.value <= 0) {
      totals.set(movement.managerId, null);
    } else {
      totals.set(movement.managerId, (totals.get(movement.managerId) ?? 0) + movement.direction * movement.value);
    }
  }
  return totals;
}
