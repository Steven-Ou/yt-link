// postcss.config.mjs
export default { // Note: 'export default' instead of 'module.exports'
  plugins: {
    tailwindcss: {}, // This plugin tells PostCSS to process Tailwind CSS
    autoprefixer: {}, // This plugin adds vendor prefixes for broader browser support
  },
};