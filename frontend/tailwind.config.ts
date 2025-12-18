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
          bg: "#0f0f1a",
          surface: "#161625",
          card: "#1e1e30",
          border: "#2a2a45",
          accent: "#6366f1",
          "accent-light": "#818cf8",
          secondary: "#ec4899",
          success: "#10b981",
          warning: "#f59e0b",
          danger: "#ef4444",
          text: "#f1f5f9",
          "text-dim": "#94a3b8",
          "text-muted": "#64748b",
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
