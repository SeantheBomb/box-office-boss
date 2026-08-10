// Seeded RNG with named streams. One stream per subsystem so an extra draw in one
// system never reshuffles another (save-compat + balance-test invariant).

export type Rng = {
  next(): number; // [0,1)
  int(min: number, max: number): number; // inclusive
  pick<T>(arr: readonly T[]): T;
  pickWeighted<T>(arr: readonly T[], weight: (t: T) => number): T;
  chance(p: number): boolean;
  shuffle<T>(arr: T[]): T[];
  gaussian(mean: number, sd: number): number;
  state(): number;
};

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    pickWeighted: (arr, weight) => {
      let total = 0;
      for (const t of arr) total += Math.max(0, weight(t));
      if (total <= 0) return arr[Math.floor(next() * arr.length)];
      let r = next() * total;
      for (const t of arr) {
        r -= Math.max(0, weight(t));
        if (r <= 0) return t;
      }
      return arr[arr.length - 1];
    },
    chance: (p) => next() < p,
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    gaussian: (mean, sd) => {
      // Box-Muller, always two draws for determinism
      const u = Math.max(next(), 1e-9);
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    state: () => a >>> 0,
  };
  return rng;
}

/** Named streams forked from a run seed. Restorable from saved per-stream states. */
export class RngBank {
  private streams = new Map<string, Rng>();
  constructor(private seed: number, private saved?: Record<string, number>) {}
  get(name: string): Rng {
    let s = this.streams.get(name);
    if (!s) {
      const init = this.saved?.[name] ?? (this.seed ^ hashString(name));
      s = makeRng(init);
      this.streams.set(name, s);
    }
    return s;
  }
  serialize(): Record<string, number> {
    const out: Record<string, number> = { ...(this.saved ?? {}) };
    for (const [k, v] of this.streams) out[k] = v.state();
    return out;
  }
}
