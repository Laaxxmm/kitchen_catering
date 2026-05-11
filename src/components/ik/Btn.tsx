import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

// Button variants from the Claude-Design handoff.
// Size 'md' is the mobile-punch default (reads as industrial, not UI chrome).

type Variant = "default" | "primary" | "outline" | "ghost" | "subtle";
type Size = "sm" | "md";

interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  children?: ReactNode;
  style?: CSSProperties;
}

const INK = "oklch(0.22 0.01 60)";
const INK2 = "oklch(0.38 0.01 60)";
const PAPER_ALT = "oklch(0.975 0.004 80)";
const RULE = "oklch(0.92 0.005 80)";
const RULE_STRONG = "oklch(0.86 0.006 80)";
const ACCENT = "oklch(0.68 0.16 45)";

const VARIANTS: Record<Variant, CSSProperties> = {
  default: { background: INK, color: "#fff", borderColor: INK },
  primary: { background: ACCENT, color: "#fff", borderColor: ACCENT },
  outline: { background: "#fff", color: INK, borderColor: RULE_STRONG },
  ghost: { background: "transparent", color: INK2, borderColor: "transparent" },
  subtle: { background: PAPER_ALT, color: INK, borderColor: RULE },
};

export function Btn({
  variant = "default",
  size = "md",
  icon,
  children,
  disabled = false,
  style,
  ...rest
}: BtnProps) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
    fontWeight: 500,
    fontSize: size === "sm" ? 12 : 13,
    padding: size === "sm" ? "5px 10px" : "7px 14px",
    borderRadius: 4,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.12s",
    border: "1px solid transparent",
    letterSpacing: "-0.005em",
    opacity: disabled ? 0.5 : 1,
  };
  return (
    <button
      disabled={disabled}
      style={{ ...base, ...VARIANTS[variant], ...style }}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 13 : 14} />}
      {children}
    </button>
  );
}
