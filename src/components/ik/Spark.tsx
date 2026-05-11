import { IK } from "./tokens";

// Sparkline + sparkbars used inside KPI cards and project rows.
// Source: handoff system.jsx · Sparkbars, Sparkline.

interface SparkProps {
  values: number[];
  height?: number;
  color?: string;
}

export function Sparkbars({ values, height = 28, color = IK.accent, gap = 2 }: SparkProps & { gap?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap, height }}>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${Math.max(2, (v / max) * 100)}%`,
            background: color,
            opacity: 0.35 + (v / max) * 0.65,
            borderRadius: "1px 1px 0 0",
          }}
        />
      ))}
    </div>
  );
}

export function Sparkline({
  values,
  width = 120,
  height = 28,
  color = IK.accent,
  fill = true,
}: SparkProps & { width?: number; fill?: boolean }) {
  if (!values || values.length === 0) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return [x, y] as const;
  });
  const path = pts
    .map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1))
    .join(" ");
  const area = path + ` L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {fill && <path d={area} fill={color} opacity=".12" />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}
