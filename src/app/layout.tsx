import type { Metadata, Viewport } from "next";
import { Inter, Fraunces, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

// Body / UI / data — Inter (self-hosted via next/font, no layout shift).
// Exposed as --font-ik-sans (kept for back-compat) and aliased to --font-sans
// in globals.css.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ik-sans",
  display: "swap",
});

// Headings / display / the one Total figure — Fraunces (variable, optical
// sizing on). Exposed as --font-serif.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  axes: ["opsz"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ik-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Greenpath",
  description:
    "B2B catering operations — orders, kitchen, deliveries, invoicing and P&L.",
  manifest: "/manifest.webmanifest",
  applicationName: "Greenpath",
  appleWebApp: {
    capable: true,
    title: "Greenpath",
    statusBarStyle: "default",
  },
  icons: {
    // SVG first — modern browsers prefer it because it scales cleanly
    // from a 16×16 favicon up to a 512×512 app tile. The PNG fallbacks
    // keep older browsers + iOS happy until we regenerate them from the
    // new mark.
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#15492F",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased" suppressHydrationWarning>
        {children}
        <Toaster
          richColors
          position="top-right"
          toastOptions={{
            classNames: {
              toast: "rounded-md border border-slate-200 shadow-card",
            },
          }}
        />
      </body>
    </html>
  );
}
