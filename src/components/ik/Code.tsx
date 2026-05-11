import type { CSSProperties, ReactNode } from "react";

// Monospace code chip — project codes, PO numbers, GSTINs.
// Uses --font-ik-mono; colour defaults to accent-ink so it reads as
// an identifier rather than body text.

interface CodeProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Code({ children, className, style }: CodeProps) {
  return (
    <span
      className={className}
      style={{
        fontFamily: "var(--font-ik-mono), ui-monospace, monospace",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.01em",
        color: "oklch(0.42 0.14 45)",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
