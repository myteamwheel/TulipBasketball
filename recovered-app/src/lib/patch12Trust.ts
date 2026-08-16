export type SecondarySourceUse = 'blend' | 'reduced' | 'review_only' | 'missing';

export function secondarySourceDecision(input: { ageHours?: number | null; ktcValue?: number | null; secondaryKtcValue?: number | null }) {
  const { ageHours, ktcValue, secondaryKtcValue } = input;
  if (secondaryKtcValue == null || secondaryKtcValue <= 0) return { use: 'missing' as SecondarySourceUse, weight: 0, reason: 'No usable secondary value.' };
  if (ageHours == null || ageHours > 36) return { use: 'review_only' as SecondarySourceUse, weight: 0, reason: 'Secondary source is not fresh enough for blending.' };
  if (ktcValue == null || ktcValue <= 0) return { use: 'review_only' as SecondarySourceUse, weight: 0, reason: 'No KTC anchor exists, so secondary value is context only.' };
  const pointGap = Math.abs(secondaryKtcValue - ktcValue);
  const pctGap = pointGap / Math.max(ktcValue, 1);
  if (pctGap >= 0.35 || (pctGap >= 0.25 && pointGap >= 750)) return { use: 'review_only' as SecondarySourceUse, weight: 0, reason: 'Secondary estimate is too far from KTC; treat as source-disagreement review, not consensus.' };
  if (pctGap >= 0.20) return { use: 'reduced' as SecondarySourceUse, weight: 0.10, reason: 'Secondary estimate differs materially, so it gets reduced weight.' };
  return { use: 'blend' as SecondarySourceUse, weight: 0.25, reason: 'Secondary estimate is fresh and close enough to KTC to blend lightly.' };
}

export function transactionValueLanguage(kind: string, hasMissingValue: boolean, added: number, dropped: number) {
  const net = added - dropped;
  if (hasMissingValue) return 'valuation incomplete';
  if (/trade/i.test(kind)) return net === 0 ? 'trade appears even on priced assets' : net > 0 ? 'trade edge on priced assets' : 'trade deficit on priced assets';
  if (dropped <= 0 && added > 0) return 'open-slot acquisition — value added, not a trade win';
  if (added > dropped) return 'roster move improved priced value';
  if (added < dropped) return 'roster move cost priced value';
  return 'priced add/drop is neutral';
}

export const PATCH_12_SOURCE_RULES = [
  'KTC is the anchor and remains the primary value source.',
  'Stats Guy can be daily-updated but still lag breaking news; large gaps are review flags.',
  'Secondary sources must be translated to KTC scale and then freshness/outlier checked.',
  'Sleeper IDs must be resolved through the player map before user-facing cards claim an asset name.',
  'Waiver and free-agent moves are roster-value changes, not two-sided trade wins.'
] as const;
