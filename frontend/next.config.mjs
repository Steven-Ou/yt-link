/** @type {import('next').NextConfig} */
const nextConfig = {
  // This line tells Next.js to export your app as static files.
  output: 'export',
  
  // This is important for Electron to find your files correctly.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
