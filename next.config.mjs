/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Quiet dev-server hot-reload churn by letting the Router keep rendered
  // pages in memory for a short window. Tab-switches within the app hit the
  // cached payload first, so going Projects → Invoices → Clients → Projects
  // doesn't re-run each page's server work every time.
  experimental: {
    serverActions: {
      // Punch-out uploads up to 10 photos — bump ceiling accordingly.
      bodySizeLimit: "30mb",
    },
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
