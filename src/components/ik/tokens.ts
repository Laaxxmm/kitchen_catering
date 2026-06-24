// src/components/ik/tokens.ts
// Colour tokens for inline-style use (shell components, SVG fills, dynamic
// palette switching). Each value is a CSS variable defined in globals.css
// (`:root` light + `.dark` override), so inline `style={{ background: IK.card }}`
// re-themes automatically when `.dark` is toggled on <html>. Tailwind
// `bg-brand-*` / `bg-ik-*` classes (also var-backed) are the primary path;
// this object exists for the handful of places where a class won't do.
//
// NOTE: do NOT use these for @react-pdf rendering — react-pdf can't resolve
// CSS variables. PDFs hardcode their own brand hex.

export const IK = {
  paper:           "var(--ik-paper)",
  paperAlt:        "var(--ik-paper-alt)",
  card:            "var(--ik-card)",
  ink:             "var(--ik-ink)",
  ink2:            "var(--ik-ink2)",
  ink3:            "var(--ik-ink3)",
  ink4:            "var(--ik-ink4)",
  rule:            "var(--ik-rule)",
  ruleStrong:      "var(--ik-rule-strong)",

  // Brand — Emerald
  accent:          "var(--ik-accent)",  // action emerald (buttons / fills)
  accentHover:     "var(--ik-accent-hover)",
  accentInk:       "var(--ik-accent-ink)",   // deep brand emerald (titles)
  accentWash:      "var(--ik-accent-wash)",
  accentWashHover: "var(--ik-accent-wash-hover)",

  // Gold — accents only
  gold:            "var(--ik-gold)",
  goldText:        "var(--ik-gold-text)",
  goldSoft:        "var(--ik-gold-soft)",

  // Semantic
  positive:        "var(--ik-positive)",
  positiveWash:    "var(--ik-positive-wash)",
  alert:           "var(--ik-alert)",
  alertWash:       "var(--ik-alert-wash)",
  amber:           "var(--ik-amber)",
  amberWash:       "var(--ik-amber-wash)",
  info:            "var(--ik-info)",
  infoWash:        "var(--ik-info-wash)",
} as const;

export type IKToken = keyof typeof IK;
