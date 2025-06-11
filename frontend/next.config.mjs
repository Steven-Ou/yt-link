// frontend/next.config.mjs

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',

  // --- ADD THIS LINE ---
  // This tells Next.js to use relative paths for assets, which is
  // necessary for the app to work correctly when loaded via the
  // file:// protocol in an Electron app.
  assetPrefix: './',

  reactStrictMode: true,
};

export default nextConfig;
