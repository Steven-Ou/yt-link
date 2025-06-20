/** @type {import('next').NextConfig} */
const nextConfig = {
  // This tells Next.js to generate a folder with static HTML/CSS/JS files.
  // This is required for Electron.
  output: 'export',

  // THIS IS THE FIX YOU FOUND AND IT IS CORRECT:
  // This tells Next.js to use relative paths for all assets (CSS, JS, etc.).
  // Instead of creating paths like `/_next/...`, it will create `./_next/...`.
  // The `./` makes the path relative to the `index.html` file, which is
  // essential for it to work correctly when loaded from the local filesystem
  // (the `file://` protocol) in a packaged Electron application.
  assetPrefix: './',

  // This is also a best practice for Electron to prevent errors with
  // Next.js's server-based image optimization, which doesn't exist in a static build.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
