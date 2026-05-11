import * as React from "react";
import { KPI, Sparkline } from "@/components/ik";

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  delta?: string;
  deltaDirection?: "up" | "down" | "flat";
  sub?: React.ReactNode;
  spark?: number[];
  sparkColor?: string;
  className?: string;
}

/**
 * Editorial KPI card (ex-sapphire StatCard). Forwards to IK <KPI/> so the
 * entire dashboard inherits the warm-paper look without touching every page.
 *
 * - `delta` of the form "+12%" or "-3%" becomes the numeric trend prop on KPI.
 * - `spark` draws a sparkline in the accent colour.
 */
export function StatCard({
  label,
  value,
  delta,
  deltaDirection,
  sub,
  spark,
  sparkColor,
}: StatCardProps) {
  let trend: number | undefined;
  if (delta) {
    const m = delta.match(/-?\d+(?:\.\d+)?/);
    if (m) {
      const n = Number(m[0]);
      trend = deltaDirection === "down" ? -Math.abs(n) : n;
    }
  }

  return (
    <KPI
      label={label}
      value={value}
      sub={sub}
      trend={trend}
      spark={
        spark && spark.length > 1 ? (
          <Sparkline values={spark} width={120} height={24} color={sparkColor} />
        ) : undefined
      }
    />
  );
}
