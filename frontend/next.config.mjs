/** @type {import('next').NextConfig} */
const nextConfig = {
    // This is the key change for the production build.
    // It ensures that all asset paths (for JS, CSS, images) are relative,
    // which is required for the app to work when loaded from the filesystem (via file:// protocol).
    assetPrefix: './',
    
    // Configures Next.js to produce a static export.
    output: "export",
    
    // This is required for static exports to work correctly with images.
    images: {
        unoptimized: true,
    },
};

export default nextConfig;
