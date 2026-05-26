// Brand mark + "Greenpath" lockup.
// The mark is a stylised chef's toque on a brand-green rounded square —
// reads as "kitchen" at any size from 14px favicon up to 36px hero.
// Two tones: ink (paper-cream backgrounds) and light (dark surfaces / topbar).

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
      <ChefToqueMark size={glyph} />
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
          Green<span style={{ fontWeight: 500, color: tone === "ink" ? ACCENT_INK : "#fff" }}>path</span>
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

/**
 * The mark on its own — chef's toque on a brand-green rounded square.
 * Exported so the sidebar collapsed-state, login screen, and any
 * future favicon-style usage can share one drawing.
 */
export function ChefToqueMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ flex: "none" }} aria-hidden>
      <rect x="2" y="2" width="36" height="36" rx="6" fill={ACCENT} />
      {/* Hat puff — three overlapping circles for the classic "cloud" silhouette */}
      <circle cx="14" cy="20" r="5" fill="#fff" />
      <circle cx="20" cy="17" r="6" fill="#fff" />
      <circle cx="26" cy="20" r="5" fill="#fff" />
      {/* Hat band */}
      <rect x="10" y="25" width="20" height="6.5" rx="1.6" fill="#fff" />
      {/* Subtle inner crease on the band */}
      <line x1="11.5" y1="28.25" x2="28.5" y2="28.25" stroke={ACCENT} strokeOpacity="0.35" strokeWidth="0.7" />
    </svg>
  );
}
