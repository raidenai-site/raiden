import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        space: {
          bg: "#0a0a0a",
          surface: "#141414",
          card: "#1e1e1e",
          border: "#2a2a2a",
          accent: "#2563eb",
          "accent-light": "#3b82f6",
          secondary: "#60a5fa",
          success: "#10b981",
          warning: "#f59e0b",
          danger: "#ef4444",
          text: "#f4f4f5",
          "text-dim": "#a1a1aa",
          "text-muted": "#52525b",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "sans-serif"],
      },
      animation: {
        "slide-up": "slide-up 0.3s ease-out forwards",
        "fade-in": "fade-in 0.3s ease-out forwards",
        "pulse-slow": "pulse 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
