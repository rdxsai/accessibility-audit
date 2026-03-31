/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './sidepanel.html',
    './src/sidepanel/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [require('@tailwindcss/typography')],
};
