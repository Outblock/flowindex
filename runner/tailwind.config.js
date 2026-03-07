/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../packages/auth-ui/src/**/*.{ts,tsx}',
  ],
  theme: { extend: {} },
  plugins: [],
};
