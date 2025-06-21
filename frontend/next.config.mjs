/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    distDir: 'out',
    // This line is the fix. It forces Next.js to use relative paths for assets.
    assetPrefix: './',
};

export default nextConfig;
