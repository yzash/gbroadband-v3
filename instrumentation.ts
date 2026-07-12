/**
 * Next.js instrumentation hook. Runs once per server process.
 * The simulation engine is a process-wide singleton booted here (M2),
 * guarded so it never double-initialises across HMR or route workers.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // M2: dynamically import and boot the engine singleton.
  // await (await import("./src/lib/engine")).bootEngine();
}
