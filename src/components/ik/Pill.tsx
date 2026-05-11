import type { CSSProperties, ReactNode } from "react";

// Status pill — monospace, uppercase, 3px radius. The dot carries the
// status, the case carries the hierarchy. Source: handoff system.jsx.

export type PillTone = "positive" | "alert" | "amber" | "blue" | "accent" | "ink";
export type PillSize = "sm" | "md";

interface PillProps {
  tone?: PillTone;
  size?: PillSize;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

const TONE: Record<PillTone, { bg: string; fg: string; dot: string }> = {
  positive: {
    bg: "oklch(0.96 0.03 155)",
    fg: "oklch(0.58 0.11 155)",
    dot: "oklch(0.58 0.11 155)",
  },
  alert: {
    bg: "oklch(0.965 0.04 25)",
    fg: "oklch(0.58 0.18 25)",
    dot: "oklch(0.58 0.18 25)",
  },
  amber: {
    bg: "oklch(0.97 0.04 85)",
    fg: "oklch(0.5 0.14 70)",
    dot: "oklch(0.74 0.14 78)",
  },
  blue: {
    bg: "oklch(0.965 0.02 240)",
    fg: "oklch(0.56 0.12 240)",
    dot: "oklch(0.56 0.12 240)",
  },
  accent: {
    bg: "oklch(0.965 0.022 55)",
    fg: "oklch(0.42 0.14 45)",
    dot: "oklch(0.68 0.16 45)",
  },
  ink: {
    bg: "oklch(0.975 0.004 80)",
    fg: "oklch(0.38 0.01 60)",
    dot: "oklch(0.55 0.01 60)",
  },
};

export function Pill({
  tone = "ink",
  size = "md",
  dot = false,
  children,
  className,
  style,
}: PillProps) {
  const t = TONE[tone];
  const padding = size === "sm" ? "1px 6px" : "2px 8px";
  const fontSize = size === "sm" ? 10 : 11;
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding,
        borderRadius: 3,
        background: t.bg,
        color: t.fg,
        fontFamily: "var(--font-ik-mono), ui-monospace, monospace",
        fontSize,
        fontWeight: 500,
        letterSpacing: "0.03em",
        textTransform: "uppercase",
        border: `1px solid ${t.fg}22`,
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 5,
            background: t.dot,
          }}
        />
      )}
      {children}
    </span>
  );
}
