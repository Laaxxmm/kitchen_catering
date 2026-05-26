import type { CapacitorConfig } from "@capacitor/cli";

// Thin-wrapper configuration. The WebView loads the live Next.js app via
// `server.url`; webDir holds only a fallback index.html for offline-start cases.
// When we later ship a static-exported bundle, `server.url` comes out and
// `webDir` points at the Next `out/` directory.
const config: CapacitorConfig = {
  appId: "com.indefine.kitchen",
  appName: "Greenpath",
  webDir: "dist-mobile",
  server: {
    // Production server. The WebView loads the live Next.js app from this URL
    // on launch. Custom domain (not the *.up.railway.app placeholder) so the
    // APK keeps working if we ever migrate hosts — the DNS stays the same.
    url: "https://kitchen.indefine.in",
    androidScheme: "https",
    cleartext: false,
    allowNavigation: [
      "kitchen.indefine.in",
      // Wildcard covers any future subdomain (e.g. staging.indefine.in).
      "*.indefine.in",
    ],
  },
  android: {
    backgroundColor: "#F9F4E7",
  },
  plugins: {
    StatusBar: {
      // Reserve space for the system status bar — do NOT overlay the WebView.
      // Android 15 (API 35) defaults to edge-to-edge; this opts us out so
      // page headers don't fight the clock / notification icons.
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#0F6E56",
    },
  },
};

export default config;
