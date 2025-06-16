// frontend/next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  // This tells Next.js to produce a static export that can be
  // loaded in Electron. This is the new way of doing 'next export'.
  output: 'export',
  
  // This is CRITICAL for Electron. It ensures that all asset paths
  // (for JS, CSS, etc.) are relative, so they work correctly when
  // loaded from the local file system using the `file://` protocol.
  assetPrefix: './',
  
  // Optional but recommended: helps find potential problems in the app
  // during development by running some checks and warnings.
  reactStrictMode: true,

  // Good practice for static exports to ensure all paths end with a
  // slash, which prevents ambiguity in how paths are resolved.
  trailingSlash: true,
};

export default nextConfig;
