/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bubblegum: { DEFAULT: '#F9A8D4', 300: '#FBC4E2', 600: '#E97DB8', 700: '#BE3F8D' },
        lavender: { DEFAULT: '#C4B5FD', 200: '#DDD3FE', 700: '#6D4FD6' },
        cream: '#FFF7ED',
        plum: { DEFAULT: '#3F3047', 700: '#5A4A63', 500: '#6E5C78' },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Nunito', 'ui-rounded', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 8px 30px -12px rgba(63,48,71,0.25)',
        lift: '0 14px 40px -14px rgba(63,48,71,0.35)',
        glow: '0 0 25px -5px rgba(249, 168, 212, 0.45)',
      },
      borderRadius: { '4xl': '2rem' },
      keyframes: {
        pop: { '0%': { transform: 'scale(.6)', opacity: '0' }, '70%': { transform: 'scale(1.08)' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        rise: { '0%': { transform: 'translateY(0) scale(.6)', opacity: '0' }, '20%': { opacity: '1' }, '100%': { transform: 'translateY(-140px) scale(1)', opacity: '0' } },
        fadeIn: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        pop: 'pop .45s ease-out both',
        floaty: 'floaty 5s ease-in-out infinite',
        rise: 'rise 1.6s ease-out forwards',
        'fade-in': 'fadeIn .3s ease-out both',
      },
    },
  },
  plugins: [],
};
