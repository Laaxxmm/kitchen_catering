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
        // deep brand emerald (titles / links). Ramp tuned for AA on ivory.
        brand: {
          DEFAULT: "#166534",
          hover: "#125429",
          foreground: "#ffffff",
          50: "#E7F2EA",
          100: "#D2E7D9",
          200: "#A9D1B5",
          300: "#74B188",
          400: "#34875A",
          500: "#166534",
          600: "#125429",
          700: "#15492F",
          800: "#103A26",
          900: "#0B2C1D",
        },
        // Gold — accents only (bars, links, focus, asterisks, badges).
        // Use `text-gold-text` for text (AA-safe); `gold` for decorative fills.
        gold: {
          DEFAULT: "#B5882E",
          text: "#9A6B14",
          soft: "#FBEFD2",
        },
        // Surfaces + ink — ivory canvas, warm charcoal ink.
        // Reference via `bg-ik-paper`, `text-ik-ink-2`, `border-ik-rule`, etc.
        ik: {
          paper: "#FAF6EE",
          "paper-alt": "#FBF9F3",
          ink: "#20251F",
          "ink-2": "#6E7268",
          "ink-3": "#A9ADA3",
          "ink-4": "#C2C5BC",
          rule: "#EAE2D2",
          "rule-strong": "#DED4C0",
          card: "#ffffff",
          // brand-aliased tokens for components that need a semantic name
          accent: "#166534",
          "accent-ink": "#15492F",
          "accent-wash": "#E7F2EA",
        },
        // Semantic status — kept separate from the brand for legibility.
        positive: { DEFAULT: "#166534", wash: "#E7F2EA" },
        alert:    { DEFAULT: "#B42318", wash: "#FEE4E2" },
        amber:    { DEFAULT: "#B54708", wash: "#FEF0C7" },
        info:     { DEFAULT: "#185FA5", wash: "#E6F1FB" },
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
