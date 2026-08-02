import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gold: "#C9A84C",
        milk: "#FDFAF5",
        champagne: "#E8D5A3",
        ink: "#1A1A1A",
        cream: "#F0EAE0",
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
        accent: ["var(--font-accent)", "serif"],
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        soft: "0 4px 24px rgba(26,26,26,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
