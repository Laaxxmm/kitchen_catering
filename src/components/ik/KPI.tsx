import type { ReactNode } from "react";
import { IK } from "./tokens";

// Editorial KPI card — 14×16 padding, monospace label, 24px figure, optional trend + spark.
// Source: handoff system.jsx · KPI.

interface KPIProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  trend?: number;
  accent?: boolean;
  active?: boolean;
  spark?: ReactNode;
  onClick?: () => void;
}

export function KPI({
  label,
  value,
  sub,
  trend,
  accent = false,
  active = false,
  spark,
  onClick,
}: KPIProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: accent ? IK.accentWash : IK.card,
        border: `1px solid ${active ? IK.accent : IK.rule}`,
        borderRadius: 4,
        padding: "14px 16px",
        cursor: onClick ? "pointer" : "default",
        position: "relative",
        transition: "border-color .15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div
          className="ik-caps"
          style={{ color: IK.ink3 }}
        >
          {label}
        </div>
        {trend !== undefined && (
          <div
            style={{
              fontFamily: "var(--font-ik-mono), ui-monospace, monospace",
              fontSize: 10,
              color: trend >= 0 ? IK.positive : IK.alert,
              fontWeight: 600,
            }}
          >
            {trend >= 0 ? "+" : ""}
            {trend}%
          </div>
        )}
      </div>
      <div
        style={{
          fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
          fontSize: 24,
          fontWeight: 600,
          color: IK.ink,
          letterSpacing: "-0.02em",
          marginTop: 6,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
            fontSize: 11.5,
            color: IK.ink3,
            marginTop: 3,
          }}
        >
          {sub}
        </div>
      )}
      {spark && <div style={{ marginTop: 10 }}>{spark}</div>}
    </div>
  );
}
