// Green-square brand mark + "Indefine Kitchen" lockup.
// Two tones: ink (paper-cream backgrounds) and light (dark surfaces / topbar).
// Matches SAB's proportions; only the colours, glyph, and text differ.

type Tone = "ink" | "light";

interface WordmarkProps {
  size?: number;
  tone?: Tone;
  showTag?: boolean;
}

const ACCENT = "#0F6E56";
const ACCENT_INK = "#085041";
const INK = "oklch(0.22 0.012 80)";
const INK_MUTED = "oklch(0.55 0.012 80)";

export function Wordmark({ size = 18, tone = "ink", showTag = true }: WordmarkProps) {
  const color = tone === "ink" ? INK : "#fff";
  const muted = tone === "ink" ? INK_MUTED : "rgba(255,255,255,0.7)";
  const glyph = size * 1.5;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.55 }}>
      <svg width={glyph} height={glyph} viewBox="0 0 40 40" style={{ flex: "none" }}>
        <rect x="2" y="2" width="36" height="36" rx="6" fill={ACCENT} />
        {/* Stylised basil leaf */}
        <path
          d="M20 9 C13 13, 11 22, 14 28 C16 31, 19 31, 21 30 C25 28, 28 22, 28 16 C28 12, 24 9, 20 9 Z"
          fill="#fff"
          opacity="0.95"
        />
        <path
          d="M20 11 L20 28"
          stroke={ACCENT}
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <div style={{ lineHeight: 1.05 }}>
        <div
          style={{
            fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
            fontWeight: 500,
            letterSpacing: "-0.01em",
            fontSize: size,
            color,
          }}
        >
          Indefine{" "}
          <span style={{ fontWeight: 500, color: tone === "ink" ? ACCENT_INK : "#fff" }}>
            Kitchen
          </span>
        </div>
        {showTag && (
          <div
            style={{
              fontFamily: "var(--font-ik-mono), ui-monospace, monospace",
              fontSize: Math.max(9, size * 0.52),
              color: muted,
              letterSpacing: "0.04em",
              marginTop: 2,
            }}
          >
            Catering operations
          </div>
        )}
      </div>
    </div>
  );
}
