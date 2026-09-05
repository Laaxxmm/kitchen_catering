/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  experimental: {
    serverActions: {
      // PDF + photo uploads up to ~10 attachments — bump ceiling.
      bodySizeLimit: "30mb",
    },
    // Let the Router keep rendered pages in memory for a short window
    // so tab-switches inside the app reuse the cached payload.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },

  // Railway terminates TLS but sets none of these. Without them the login
  // and admin pages could be framed from another origin, and a browser that
  // once saw http:// would keep trying it. No CSP yet: the theme snippet in
  // app/layout.tsx and Next's own inline scripts would need nonces first.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // SAMEORIGIN, not DENY: the app opens its own PDFs in-page.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Drivers photograph deliveries and share location; nothing else.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
