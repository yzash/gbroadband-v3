/**
 * Next.js instrumentation hook. Runs once per server process.
 * Boots the simulation engine singleton (guarded against double-init).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootEngine } = await import("./src/lib/engine");
  bootEngine();
}
