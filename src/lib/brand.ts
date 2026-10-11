/**
 * Globe brand tokens — the single source of truth for every colour and font in
 * the app. Tailwind (tailwind.config.ts) and all JavaScript consumers (map
 * layers, charts, sparklines) read from here.
 *
 * ⚠ Approximated from Globe Telecom's public identity — NOT from an official
 * brand guide. Swap these values for the official ones when the guide arrives;
 * nothing else needs to change. Every approximated value is marked below.
 */

export const BRAND = {
  // ---- Globe identity (APPROXIMATED) ----
  globeBlue: "#0033A0", // primary brand blue — brand mark, primary surfaces
  globeBlueBright: "#2F6BFF", // interactive blue on dark (buttons, links, focus)
  globeSky: "#3CB7FF", // signature highlight — selection, active nav, map focus
  globeNavy: "#061A4D", // deep brand navy

  // ---- Command-centre canvas (navy-tinted neutrals) ----
  canvas: "#050B1D",
  surface: "#0A1430",
  surface2: "#0F1B3D",
  surface3: "#172752",
  line: "#1D2C56",
  line2: "#2A3D70",

  // ---- Text ----
  ink: "#EEF3FF",
  ink2: "#AFBCDB",
  ink3: "#7586AE",

  // ---- Semantic status (independent of brand; tuned for the navy canvas) ----
  healthy: "#1FC98E",
  watch: "#FFC542",
  degraded: "#FF8A3D",
  critical: "#FF4D5E",
  unsensed: "#4D5E8A", // no telemetry (dark ONT)
  record: "#A98BFF", // plant-records / record-confidence semantics
  inferred: "#8D9CC2", // silent sufferers (inferred, not observed)
} as const;

/** Fonts (APPROXIMATED): Montserrat stands in for Globe's geometric brand face. */
export const FONTS = {
  display: '"Montserrat", "Source Sans 3", ui-sans-serif, system-ui, sans-serif',
  sans: '"Source Sans 3", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

/** Sequential ramp for intensity layers (tickets, ₱ at risk): navy → Globe sky. */
export const SEQ = ["#0F1B3D", "#123A7A", "#1857B8", "#2F6BFF", "#3CB7FF", "#9FE0FF"] as const;
