/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
      './pages/**/*.{js,ts,jsx,tsx,mdx}',
      './components/**/*.{js,ts,jsx,tsx,mdx}',
      './app/**/*.{js,ts,jsx,tsx,mdx}', // This line is crucial for the app directory
      // Add any other folders where you write Tailwind classes
    ],
    theme: {
      extend: {
        // You can define custom colors or other theme extensions here
      },
    },
    plugins: [],
  };