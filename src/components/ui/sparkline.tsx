import * as React from "react";

export interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
}

/**
 * Minimal SVG sparkline — stroke + light fill underneath.
 * Default color tracks the IK brand accent token.
 */
export function Sparkline({
  data,
  color = "var(--ik-accent, #d17a3b)",
  width = 80,
  height = 28,
  strokeWidth = 1.5,
  className,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return <svg width={width} height={height} className={className} />;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const rng = max - min || 1;
  const points = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * width},${height - ((v - min) / rng) * height}`,
    )
    .join(" ");
  return (
    <svg width={width} height={height} className={className}>
      <polyline
        fill={color}
        fillOpacity="0.1"
        stroke="none"
        points={`0,${height} ${points} ${width},${height}`}
      />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
