import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}", "./content/**/*.{md,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0B1220",
          900: "#0B1220",
          800: "#101A2E",
          700: "#1A2742",
          600: "#3A4868",
          500: "#5A6886",
          400: "#8190AE",
          300: "#B6C0D4",
          200: "#DCE2EE",
          100: "#EEF2F7",
          50:  "#F7F9FC"
        },
        cyan: {
          50:  "#ECFEFF",
          100: "#CFFAFE",
          200: "#A5F3FC",
          300: "#67E8F9",
          400: "#22D3EE",
          500: "#06B6D4",
          600: "#0891B2",
          700: "#0E7490",
          800: "#155E75",
          900: "#164E63"
        }
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Inter Display", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      fontSize: {
        // tighter, more confident display sizes
        "display-1": ["clamp(3.25rem, 7vw, 6.5rem)", { lineHeight: "0.98", letterSpacing: "-0.035em", fontWeight: "500" }],
        "display-2": ["clamp(2.5rem, 5vw, 4.5rem)",   { lineHeight: "1.02", letterSpacing: "-0.03em",  fontWeight: "500" }],
        "display-3": ["clamp(2rem, 3.4vw, 3rem)",     { lineHeight: "1.08", letterSpacing: "-0.02em",  fontWeight: "500" }]
      },
      letterSpacing: {
        mono: "0.12em"
      },
      boxShadow: {
        soft: "0 1px 0 rgba(11,18,32,0.04), 0 6px 24px -8px rgba(11,18,32,0.06)",
        card: "0 1px 0 rgba(11,18,32,0.04), 0 12px 32px -16px rgba(11,18,32,0.08)"
      }
    }
  },
  plugins: []
};
export default config;
