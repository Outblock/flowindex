const preset = require('@flowindex/flow-ui/tailwind-preset');
/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [preset],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Inconsolata', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
        '4xl': '1.5rem',
      },
      colors: {
        wallet: {
          bg: '#0a0b0f',
          surface: '#141519',
          'surface-hover': '#1a1b21',
          border: '#1e2028',
          'border-light': '#2a2c36',
          muted: '#6b7084',
          accent: '#00ef8b',
          'accent-dim': 'rgba(0, 239, 139, 0.12)',
        },
      },
    },
  },
};
