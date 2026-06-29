import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}", "./lib/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        line: "#d8dee8",
        canvas: "#f6f8fb",
        panel: "#ffffff"
      },
      boxShadow: {
        panel: "0 8px 24px rgba(15, 23, 42, 0.08)"
      },
      borderRadius: {
        tool: "8px"
      }
    }
  },
  plugins: []
};

export default config;
