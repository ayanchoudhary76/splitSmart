/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#6C63FF',
          accent:  '#FF6584',
          dark:    '#1A1A2E',
          surface: '#F7F7FD',
          border:  '#E2E2F0',
        }
      }
    },
  },
  plugins: [],
}
