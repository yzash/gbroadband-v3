import type { Config } from "tailwindcss";
import { BRAND as B, FONTS } from "./src/lib/brand";

/**
 * Tailwind tokens derive from src/lib/brand.ts (the single brand source).
 * Legacy token names (base, surface, doctrine, healthy…) are kept so every
 * screen inherits the Globe palette without per-file changes.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: B.canvas,
        surface: B.surface,
        "surface-2": B.surface2,
        "surface-3": B.surface3,
        line: B.line,
        "line-2": B.line2,
        ink: B.ink,
        "ink-2": B.ink2,
        "ink-3": B.ink3,
        // Interactive accent (legacy name "doctrine") = Globe interactive blue.
        doctrine: B.globeBlueBright,
        "doctrine-dim": "#173A8A",
        globe: {
          DEFAULT: B.globeBlue,
          bright: B.globeBlueBright,
          sky: B.globeSky,
          navy: B.globeNavy,
        },
        healthy: B.healthy,
        watch: B.watch,
        degraded: B.degraded,
        critical: B.critical,
        unsensed: B.unsensed,
        live: B.healthy,
        record: B.record,
        inferred: B.inferred,
        "ge-blue": "#4285f4",
        "ge-red": "#ea4335",
        "ge-yellow": "#fbbc05",
        "ge-green": "#34a853",
      },
      fontFamily: {
        sans: FONTS.sans.split(",").map((s) => s.trim()),
        display: FONTS.display.split(",").map((s) => s.trim()),
        mono: FONTS.mono.split(",").map((s) => s.trim()),
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        card: "0.625rem",
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.03) inset, 0 10px 28px rgba(0,8,30,0.45)",
        float: "0 12px 40px rgba(0,6,24,0.6), 0 0 0 1px rgba(60,183,255,0.06)",
        halo: "0 0 0 3px rgba(60,183,255,0.28)",
      },
      keyframes: {
        pulse2: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
        halo: {
          "0%": { opacity: "0.7", transform: "scale(0.9)" },
          "70%": { opacity: "0", transform: "scale(2.2)" },
          "100%": { opacity: "0", transform: "scale(2.2)" },
        },
        rise: { "0%": { opacity: "0", transform: "translateY(4px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        pulse2: "pulse2 1.8s ease-in-out infinite",
        halo: "halo 2.4s ease-out infinite",
        rise: "rise 220ms ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
