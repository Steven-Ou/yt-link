// frontend/postcss.config.mjs
/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    // This is the new plugin required by newer versions of Tailwind/Next.js
    // It replaces the direct 'tailwindcss' entry.
    '@tailwindcss/postcss': {},
    'autoprefixer': {},
  },
};

export default config;
