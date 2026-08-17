interface Point { value: number; observedAt: string; }

export default function Sparkline({ points, width = 96, height = 28 }: { points: Point[]; width?: number; height?: number }) {
  if (points.length < 2) return <div style={{ width, height }} className="flex items-center text-[10px] text-neutral-600">n/a</div>;
  const ordered = [...points].sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
  const values = ordered.map((point) => point.value);
  const times = ordered.map((point) => new Date(point.observedAt).getTime());
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const first = times[0], last = times[times.length - 1], timeRange = Math.max(1, last - first), pad = 2;
  const coords = ordered.map((point, index) => {
    const x = pad + ((times[index] - first) / timeRange) * (width - pad * 2);
    const y = pad + (1 - (point.value - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const path = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const stroke = values[values.length - 1] >= values[0] ? "#34d399" : "#f87171";
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-label="Time-scaled KTC trend"><path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
