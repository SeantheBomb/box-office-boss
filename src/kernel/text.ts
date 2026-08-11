// Madlib composer: [bank:*] lines picked with the dialogue RNG stream, {slot} filled from ctx.

import type { Rng } from "./rng";
import type { Content } from "./types";

export type BankEntry = string | { t: string; tags?: Record<string, string | string[]>; w?: number };

export function bankLine(rng: Rng, content: Content, name: string, ctx: Record<string, any> = {}): string {
  const banks = content.templates.banks as Record<string, BankEntry[]>;
  const bank = banks[name];
  if (!bank || bank.length === 0) return `[missing bank: ${name}]`;
  return fill(entryText(rng.pick(bank)), ctx);
}

const entryText = (e: BankEntry) => (typeof e === "string" ? e : e.t);

/** Utility-based selection: candidates scored by tag agreement with the context and a
 *  recency penalty, then weighted-picked from the top. Procedural, not random —
 *  a Fall awards email pulls awards-flavored lines; a hostile board pulls hostile ones. */
export function selectLine(
  rng: Rng,
  bank: BankEntry[],
  ctx: Record<string, any>,
  recent: string[]
): string {
  const scored = bank.map((e) => {
    const text = entryText(e);
    let score = typeof e === "string" ? 1 : e.w ?? 1;
    if (typeof e !== "string" && e.tags) {
      for (const [k, want] of Object.entries(e.tags)) {
        const have = ctx[k];
        if (have === undefined) continue;
        const wants = Array.isArray(want) ? want : [want];
        score *= wants.includes(String(have)) ? 3 : 0.25; // tagged-for-this-context lines dominate
      }
    }
    const idx = recent.indexOf(text);
    if (idx >= 0) score *= 0.05 + 0.1 * (recent.length - 1 - idx); // hard recency penalty
    return { text, score: score * (0.8 + rng.next() * 0.4) };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  return top[rng.pickWeighted([0, 1, 2].slice(0, top.length), (i) => top[i].score)].text;
}

export function fill(template: string, ctx: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => (ctx[key] !== undefined ? String(ctx[key]) : `{${key}}`));
}

export function money(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function count(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}
