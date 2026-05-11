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
        // Brand accent (Fresh basil) — deep teal-green.
        // Matches Vision/Forecast brand for cross-product coherence.
        brand: {
          DEFAULT: "#0F6E56",
          hover: "#0B5440",
          foreground: "#ffffff",
          50: "#E1F5EE",
          100: "#C8EBDD",
          200: "#9FE1CB",
          300: "#5DCAA5",
          400: "#1D9E75",
          500: "#0F6E56",
          600: "#0B5440",
          700: "#085041",
          800: "#063A2F",
          900: "#04342C",
        },
        // Surfaces + ink — paper-cream canvas, deep warm ink.
        // Reference via `bg-ik-paper`, `text-ik-ink-2`, `border-ik-rule`, etc.
        ik: {
          paper: "oklch(0.985 0.003 95)",
          "paper-alt": "oklch(0.975 0.005 95)",
          ink: "oklch(0.22 0.012 80)",
          "ink-2": "oklch(0.38 0.012 80)",
          "ink-3": "oklch(0.55 0.012 80)",
          "ink-4": "oklch(0.72 0.010 80)",
          rule: "oklch(0.92 0.006 95)",
          "rule-strong": "oklch(0.86 0.008 95)",
          card: "#ffffff",
          // brand-aliased tokens for components that need a semantic name
          accent: "#0F6E56",
          "accent-ink": "#085041",
          "accent-wash": "#E1F5EE",
        },
        // Semantic — keep SAB's structure, retune values for Fresh basil
        positive: { DEFAULT: "#3B6D11", wash: "#EAF3DE" },
        alert:    { DEFAULT: "#A32D2D", wash: "#FCEBEB" },
        amber:    { DEFAULT: "#BA7517", wash: "#FAEEDA" },
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
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
        // Fresh basil typography — Inter Tight / IBM Plex Mono via CSS vars.
        // Mobile shell opts in via `font-ik-sans`; desktop stays on system-ui.
        "ik-sans": ["var(--font-ik-sans)", "Inter Tight", "Inter", "system-ui", "sans-serif"],
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
