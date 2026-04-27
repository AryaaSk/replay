/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // "Field Log" palette: warm charcoal + bone + vermilion accent
        ink:      "#16140F",  // primary background, slightly warmer than pure black
        carbon:   "#1E1B17",  // raised surface
        char:     "#262320",  // raised surface 2 / hover
        rule:     "#34302B",  // borders, ledger rules
        grit:     "#4A453F",  // tertiary border, disabled
        bone:     "#F0EAD9",  // primary text — warm bone, not pure white
        ash:      "#9A938A",  // secondary text
        dust:     "#6B655E",  // tertiary text
        ember:    "#E84E1B",  // single accent — record state, active, alert
        emberlow: "#B73914",  // hover/pressed
        moss:     "#8FB89E",  // counter-accent: success / saved
        sky:      "#7CB7C8",  // counter-accent: info
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        serif: ['"Instrument Serif"', "Georgia", "serif"],
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
      fontSize: {
        // Slightly tighter scale for instrument-panel density
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      animation: {
        "pulse-rec": "pulse-rec 1.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "tick": "tick 1s steps(1) infinite",
        "fade-in": "fade-in 200ms ease-out",
      },
      keyframes: {
        "pulse-rec": {
          "0%, 100%": { opacity: "1", boxShadow: "0 0 0 0 rgba(232,78,27,0.6)" },
          "50%":      { opacity: "0.85", boxShadow: "0 0 0 8px rgba(232,78,27,0)" },
        },
        "tick": {
          "50%": { opacity: "0.5" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(2px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      backgroundImage: {
        "grain": "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.06 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
      },
    },
  },
  plugins: [],
};
