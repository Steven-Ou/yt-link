// frontend/next.config.mjs

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Add this line to enable static exports
  output: 'export',

  // Your other Next.js configurations can go here
  reactStrictMode: true,
};

// Use 'export default' for .mjs files
export default nextConfig;