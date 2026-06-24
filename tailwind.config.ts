import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        // Brand — Emerald. brand-500 = action emerald (buttons), brand-700 =
        // deep brand emerald (titles / links). The action/ink/wash steps are
        // wired to CSS vars so they re-theme in dark mode; the static mid-tones
        // (200-400, 800-900) read acceptably on either canvas.
        brand: {
          DEFAULT: "var(--ik-accent)",
          hover: "var(--ik-accent-hover)",
          foreground: "#ffffff",
          50: "var(--ik-accent-wash)",
          100: "var(--ik-accent-wash-hover)",
          200: "#A9D1B5",
          300: "#74B188",
          400: "#34875A",
          500: "var(--ik-accent)",
          600: "var(--ik-accent-hover)",
          700: "var(--ik-accent-ink)",
          800: "#103A26",
          900: "#0B2C1D",
        },
        // Gold — accents only (bars, links, focus, asterisks, badges).
        // Use `text-gold-text` for text (AA-safe); `gold` for decorative fills.
        gold: {
          DEFAULT: "var(--ik-gold)",
          text: "var(--ik-gold-text)",
          soft: "var(--ik-gold-soft)",
        },
        // Surfaces + ink — ivory canvas, warm charcoal ink. Wired to CSS vars
        // so dark mode flips every surface/ink/rule at once.
        // Reference via `bg-ik-paper`, `text-ik-ink-2`, `border-ik-rule`, etc.
        ik: {
          paper: "var(--ik-paper)",
          "paper-alt": "var(--ik-paper-alt)",
          ink: "var(--ik-ink)",
          "ink-2": "var(--ik-ink2)",
          "ink-3": "var(--ik-ink3)",
          "ink-4": "var(--ik-ink4)",
          rule: "var(--ik-rule)",
          "rule-strong": "var(--ik-rule-strong)",
          card: "var(--ik-card)",
          // brand-aliased tokens for components that need a semantic name
          accent: "var(--ik-accent)",
          "accent-ink": "var(--ik-accent-ink)",
          "accent-wash": "var(--ik-accent-wash)",
        },
        // Semantic status — kept separate from the brand for legibility.
        positive: { DEFAULT: "var(--ik-positive)", wash: "var(--ik-positive-wash)" },
        alert:    { DEFAULT: "var(--ik-alert)", wash: "var(--ik-alert-wash)" },
        amber:    { DEFAULT: "var(--ik-amber)", wash: "var(--ik-amber-wash)" },
        info:     { DEFAULT: "var(--ik-info)", wash: "var(--ik-info-wash)" },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "#FFFFFF",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "#FFFFFF",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        card: "14px",
      },
      fontFamily: {
        // Emerald & Gold typography — Inter (body/data), Fraunces (display),
        // IBM Plex Mono (codes), wired to next/font CSS vars.
        sans: ["var(--font-ik-sans)", "Inter", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Playfair Display", "Georgia", "serif"],
        mono: ["var(--font-ik-mono)", "IBM Plex Mono", "ui-monospace", "monospace"],
        "ik-sans": ["var(--font-ik-sans)", "Inter", "system-ui", "sans-serif"],
        "ik-mono": ["var(--font-ik-mono)", "IBM Plex Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 1px 3px 0 rgba(15, 23, 42, 0.06)",
        "card-lg":
          "0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 4px 8px 0 rgba(15, 23, 42, 0.06)",
      },
    },
  },
  plugins: [animate],
};

export default config;
