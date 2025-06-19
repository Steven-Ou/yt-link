/** @type {import('next').NextConfig} */
const nextConfig = {
  // This line tells Next.js to generate a folder with static HTML/CSS/JS files.
  output: 'export',

  // **THE FIX IS HERE:**
  // This tells Next.js to use relative paths for all assets.
  // Instead of creating paths like `/_next/...`, it will create `./_next/...`.
  // The `./` makes the path relative to the `index.html` file, which works
  // correctly when loaded via the `file://` protocol in Electron.
  assetPrefix: './',
};

export default nextConfig;
