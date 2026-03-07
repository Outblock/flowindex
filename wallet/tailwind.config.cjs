const preset = require('@flowindex/flow-ui/tailwind-preset');
/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [preset],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
};
