// web/components/GrowthSparkline.tsx — 再生数推移のインライン・スパークライン

export function GrowthSparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;

  const w = 64;
  const h = 20;
  const pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (points.length - 1);

  const coords = points
    .map((p, i) => {
      const x = pad + i * stepX;
      const y = pad + (h - pad * 2) * (1 - (p - min) / span);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-faint"
    >
      <polyline
        points={coords}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
