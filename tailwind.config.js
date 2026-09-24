/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Fondo carbón profundo con leve gradiente
        ink: {
          950: '#0b0b0d',
          900: '#111114',
          800: '#17171b',
          700: '#1f1f25',
          600: '#2a2a32',
        },
        // Oro metálico de marca
        gold: {
          50: '#fbf6e6',
          100: '#f5e9c4',
          200: '#ecd591',
          300: '#e3c15e',
          400: '#d9ad3a',
          500: '#c99a2a',
          600: '#a67c1f',
          700: '#7d5d18',
          DEFAULT: '#d9ad3a',
        },
        // Estados
        success: '#3ecf8e',
        danger: '#ef5f5f',
        info: '#4c7fff',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        script: ['"Great Vibes"', 'cursive'],
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0, 0, 0, 0.45)',
        'gold-glow': '0 0 20px rgba(217, 173, 58, 0.25)',
      },
      backgroundImage: {
        'ink-gradient':
          'radial-gradient(circle at 20% 0%, #17171b 0%, #0b0b0d 55%)',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
