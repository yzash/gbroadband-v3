/**
 * Deterministic PRNG. Same seed + same call sequence ⇒ identical stream.
 * mulberry32 core — small, fast, good enough for a simulation world.
 * The engine and seeder share this so "seed 42 ⇒ identical world" holds.
 */
export class RNG {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.s |= 0;
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p. */
  bool(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly pick an element. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted pick: entries of [item, weight]. */
  weighted<T>(entries: readonly [T, number][]): T {
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let r = this.next() * total;
    for (const [item, w] of entries) {
      r -= w;
      if (r <= 0) return item;
    }
    return entries[entries.length - 1][0];
  }

  /** Approx. normal via sum-of-uniforms (Irwin–Hall, n=6), clamped ≥0 optional. */
  gaussian(mean: number, sd: number): number {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += this.next();
    // sum has mean 3, variance 6/12=0.5, sd = sqrt(0.5)
    const z = (sum - 3) / Math.sqrt(0.5);
    return mean + z * sd;
  }

  /** Positive gaussian (for durations). */
  gaussianPos(mean: number, sd: number, min = 0.01): number {
    return Math.max(min, this.gaussian(mean, sd));
  }

  /** Shuffle a copy (Fisher–Yates). */
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
