// frontend/next.config.mjs

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',

  // This is required for Electron to find CSS/JS files correctly.
  assetPrefix: './',
  
  reactStrictMode: true,
};

export default nextConfig;
