import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

// One family for the whole app — Plus Jakarta Sans (friendly-professional
// geometric sans). Drives --font-ik-sans; globals.css aliases the old
// --font-serif and --font-ik-mono variables to it, so every `font-serif` /
// `font-mono` call site (headings, codes, money) resolves here too without
// touching 465 usages. Numbers keep column alignment via tabular-nums on the
// mono utility rather than a monospace face — see globals.css.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-ik-sans",
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
      className={jakarta.variable}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased" suppressHydrationWarning>
        {/* No-flash theme: apply the saved choice before paint so a dark-mode
            user never sees a light flash on load. Defaults to light (the
            brand canvas) when nothing is saved. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('ik.theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
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
