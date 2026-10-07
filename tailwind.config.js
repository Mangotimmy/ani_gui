/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          red: '#E50914',
          darkRed: '#B81D24',
          black: '#141414',
          card: '#181818',
          hover: '#282828',
          gray: '#808080',
          lightGray: '#e5e5e5'
        },
        netflix: {
          red: '#E50914',
          darkRed: '#B81D24',
          black: '#141414',
          card: '#181818',
          hover: '#282828',
          gray: '#808080',
          lightGray: '#e5e5e5'
        }
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'Helvetica Neue', 'Roboto', 'sans-serif']
      }
    },
  },
  plugins: [],
}
