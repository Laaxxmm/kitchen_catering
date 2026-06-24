// src/components/ik/tokens.ts
// Colour tokens for inline-style use (SVG fills, PDF rendering, dynamic
// palette switching). Tailwind `bg-brand-*` / `bg-ik-*` classes are the
// primary way to use these; this file exists for places where a class
// won't do.

export const IK = {
  paper:           "#FAF6EE",
  paperAlt:        "#FBF9F3",
  card:            "#ffffff",
  ink:             "#20251F",
  ink2:            "#6E7268",
  ink3:            "#A9ADA3",
  ink4:            "#C2C5BC",
  rule:            "#EAE2D2",
  ruleStrong:      "#DED4C0",

  // Brand — Emerald
  accent:          "#166534",  // action emerald (buttons / fills)
  accentHover:     "#125429",
  accentInk:       "#15492F",   // deep brand emerald (titles)
  accentWash:      "#E7F2EA",
  accentWashHover: "#D2E7D9",

  // Gold — accents only
  gold:            "#B5882E",
  goldText:        "#9A6B14",
  goldSoft:        "#FBEFD2",

  // Semantic
  positive:        "#166534",
  positiveWash:    "#E7F2EA",
  alert:           "#B42318",
  alertWash:       "#FEE4E2",
  amber:           "#B54708",
  amberWash:       "#FEF0C7",
  info:            "#185FA5",
  infoWash:        "#E6F1FB",
} as const;

export type IKToken = keyof typeof IK;
