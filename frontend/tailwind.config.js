import { fontFamily } from "tailwindcss/defaultTheme"

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  // NOTE: This project uses both `app/` (TanStack/Nitro SSR) and `src/` (legacy).
  // Tailwind v3 generates utilities based on the files listed here; if `app/` is
  // missing, almost all utilities (e.g. `flex`, `grid`, spacing) get purged and
  // the UI looks "unstyled" in production.
  content: [
    "./index.html",
    "./app/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        nothing: {
          black: "#000000", // Pure Black
          dark: "#0a0a0a",  // Nearly Black
          green: "#00ef8b", // Flow Green
          'green-dark': "#059669", // Darker Green for Light Mode
          red: "#ff0000",   // Nothing Red accent
          white: "#ffffff", // Pure White
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        // ... (keep rest default)
      },
      fontFamily: {
        mono: ["Geist Mono", "monospace"],
        sans: ["Geist Sans", ...fontFamily.sans],
      },
      borderRadius: {
        lg: `var(--radius)`,
        md: `calc(var(--radius) - 2px)`,
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [import("tailwindcss-animate")],
}
