import type { Metadata, Viewport } from "next";
import { Inter_Tight, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ik-sans",
  display: "swap",
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
  themeColor: "#0F6E56",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${plexMono.variable}`}
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
