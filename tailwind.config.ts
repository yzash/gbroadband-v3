import type { Config } from "tailwindcss";

/**
 * DevX Doctrine tokens.
 * A calm, high-contrast NOC palette. Semantic names only — screens never
 * reach for raw hex. Health states double as the map/topology colour ramp.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces (dark command-center shell)
        base: "#0b0f17",
        surface: "#121826",
        "surface-2": "#1a2234",
        "surface-3": "#232d42",
        line: "#2b3854",
        // Text
        ink: "#e8edf7",
        "ink-2": "#a9b6ce",
        "ink-3": "#6b7896",
        // Brand / doctrine accent
        doctrine: "#4c8dff",
        "doctrine-dim": "#2a4a80",
        // Health ramp (topology + map + KPIs)
        healthy: "#2fbf87",
        watch: "#e5c95a",
        degraded: "#e8933a",
        critical: "#e5573f",
        unsensed: "#48557a", // dark ONT (no telemetry)
        // Provenance
        live: "#2fbf87",
        record: "#c98cff", // plant-records / verify-in-discovery
        inferred: "#7f8db0",
        // Google-styled Ask accents
        "ge-blue": "#4285f4",
        "ge-red": "#ea4335",
        "ge-yellow": "#fbbc05",
        "ge-green": "#34a853",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        card: "0.75rem",
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.35)",
        halo: "0 0 0 3px rgba(76,141,255,0.25)",
      },
      keyframes: {
        pulse2: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        halo: {
          "0%": { opacity: "0.7", transform: "scale(0.9)" },
          "70%": { opacity: "0", transform: "scale(2.2)" },
          "100%": { opacity: "0", transform: "scale(2.2)" },
        },
      },
      animation: {
        pulse2: "pulse2 1.8s ease-in-out infinite",
        halo: "halo 2.4s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
