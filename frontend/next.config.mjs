/** @type {import('next').NextConfig} */
const nextConfig = {
  // This line is crucial for Electron packaging.
  // It tells Next.js to generate a folder with static HTML/CSS/JS files.
  output: 'export',

  // Optional: If you have issues with images, you might need this.
  // images: {
  //   unoptimized: true,
  // },
};

export default nextConfig;
