// frontend/postcss.config.mjs
// This is the correct configuration for PostCSS with Tailwind CSS and Next.js.
// It loads the `tailwindcss` and `autoprefixer` plugins.

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
