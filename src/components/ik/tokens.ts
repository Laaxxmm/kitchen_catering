// src/components/ik/tokens.ts
// Colour tokens for inline-style use (SVG fills, PDF rendering, dynamic
// palette switching). Tailwind `bg-brand-*` / `bg-ik-*` classes are the
// primary way to use these; this file exists for places where a class
// won't do.

export const IK = {
  paper:           "oklch(0.985 0.003 95)",
  paperAlt:        "oklch(0.975 0.005 95)",
  card:            "#ffffff",
  ink:             "oklch(0.22 0.012 80)",
  ink2:            "oklch(0.38 0.012 80)",
  ink3:            "oklch(0.55 0.012 80)",
  ink4:            "oklch(0.72 0.010 80)",
  rule:            "oklch(0.92 0.006 95)",
  ruleStrong:      "oklch(0.86 0.008 95)",

  // Brand
  accent:          "#0F6E56",
  accentHover:     "#0B5440",
  accentInk:       "#085041",
  accentWash:      "#E1F5EE",
  accentWashHover: "#C8EBDD",

  // Semantic
  positive:        "#3B6D11",
  positiveWash:    "#EAF3DE",
  alert:           "#A32D2D",
  alertWash:       "#FCEBEB",
  amber:           "#BA7517",
  amberWash:       "#FAEEDA",
  info:            "#185FA5",
  infoWash:        "#E6F1FB",
} as const;

export type IKToken = keyof typeof IK;
