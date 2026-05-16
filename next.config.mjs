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
};

export default nextConfig;
