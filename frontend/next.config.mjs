// frontend/next.config.mjs

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',

  // This is required for Electron to find CSS/JS files correctly.
  assetPrefix: './',

  // This disables the next/font optimization which conflicts with
  // the relative assetPrefix. Your fonts will still work.
  experimental: {
    fontLoaders: [
      { loader: '@next/font/google', options: { subsets: ['latin'] } },
    ],
  },
  
  reactStrictMode: true,
};

export default nextConfig;
