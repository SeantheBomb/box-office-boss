// Madlib composer: [bank:*] lines picked with the dialogue RNG stream, {slot} filled from ctx.

import type { Rng } from "./rng";
import type { Content } from "./types";

export function bankLine(rng: Rng, content: Content, name: string, ctx: Record<string, any> = {}): string {
  const banks = content.templates.banks as Record<string, string[]>;
  const bank = banks[name];
  if (!bank || bank.length === 0) return `[missing bank: ${name}]`;
  return fill(rng.pick(bank), ctx);
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
