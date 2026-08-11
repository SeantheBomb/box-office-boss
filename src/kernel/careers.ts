// Careers: every release moves the town. Stats drift toward what actually happened
// on the picture, fame follows hits, rates chase fame, heads swell and shrink.
// All tuning lives in content/economy.json → careers / producerStaff.

import type { Rng } from "./rng";
import type { Content, Movie, Person, RunState, VfxStudio } from "./types";

export type OutcomeTier = "smash" | "hit" | "ok" | "flop" | "bomb";

export interface CareerNews {
  kind: "breakout" | "humbled" | "wrecked" | "range" | "vfxHot" | "vfxCold";
  personId?: string;
  vfxId?: string;
  name: string;
}

export function outcomeTier(content: Content, m: Movie): OutcomeTier {
  const C = content.economy.careers;
  const profit = m.revenue - m.budget;
  if (profit >= C.smashProfit) return "smash";
  if (profit >= C.hitProfit) return "hit";
  if (profit <= C.bombLoss) return "bomb";
  if (profit <= 0) return "flop";
  return "ok";
}

export function fameTier(p: Person): "rising" | "established" | "alist" {
  const f = p.fame ?? 0;
  return f >= 70 ? "alist" : f >= 35 ? "established" : "rising";
}

/** What a star of this fame SHOULD cost per day. Rates chase this with momentum. */
export function targetRate(content: Content, p: Person): number {
  const C = content.economy.careers;
  const f = Math.max(0, Math.min(1, (p.fame ?? 20) / 100));
  return Math.round((C.rateFloor + Math.pow(f, C.rateCurve) * (C.rateCeil - C.rateFloor)) / 500) * 500;
}

/** What a producer with this track record asks per week. */
export function producerAskRate(content: Content, p: Person): number {
  const S = content.economy.producerStaff;
  const track = (p.avgProdRevenue ?? 1) / Math.max(0.6, p.avgProdCost ?? 1);
  return Math.round((S.weeklyRateBase * (0.6 + (p.avgRating ?? 50) / 100) * track) / 1000) * 1000;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The aftermath pass: run once per finished picture (home video, books closed).
 * Mutates the people/VFX studio attached to the movie; returns notable turns for the trades.
 */
export function applyCareerOutcomes(content: Content, state: RunState, rng: Rng, m: Movie): CareerNews[] {
  const C = content.economy.careers;
  const tier = outcomeTier(content, m);
  const news: CareerNews[] = [];
  const person = (id?: string) => state.people.find((p) => p.id === id);
  const overran = m.spent > m.budget * 1.05;
  const messy = m.setbackCount >= C.wreckSetbacks;

  // ---- cast: fame is the currency, the rate chases it, the head swells with it ----
  for (const cid of m.castIds) {
    const p = person(cid);
    if (!p || p.fame === undefined) continue;
    const before = p.fame;
    p.fame = clamp(p.fame + C.fame[tier] + rng.int(-1, 1), 0, 100);
    // the least cooperative name on a troubled shoot wears it
    if (messy) {
      const worst = m.castIds.map(person).filter(Boolean).sort((a, b) => (a!.cooperation ?? 60) - (b!.cooperation ?? 60))[0];
      if (worst?.id === p.id) {
        p.fame = clamp(p.fame - C.wreckFame, 0, 100);
        news.push({ kind: "wrecked", personId: p.id, name: p.name });
      }
    }
    // crossing up into the A-list: the ego arrives before the trophy does
    if (before < 70 && p.fame >= 70) {
      p.cooperation = clamp((p.cooperation ?? 60) - C.egoCoopDrop, 5, 100);
      p.careerTurn = { kind: "breakout", day: state.day };
      if ((content.people.divaRiders as string[] | undefined)?.length) p.rider = rng.pick(content.people.divaRiders as string[]);
      news.push({ kind: "breakout", personId: p.id, name: p.name });
    }
    // falling back to earth: humbled, cheaper, suddenly a joy to work with
    if ((before >= 35 && p.fame < 35) || (tier === "bomb" && before >= 70)) {
      p.cooperation = clamp((p.cooperation ?? 60) + C.humbleCoopGain, 5, 100);
      p.dailyRate = Math.max(C.rateFloor, Math.round(((p.dailyRate ?? C.rateFloor) * C.humbleRateCut) / 500) * 500);
      p.careerTurn = { kind: "humbled", day: state.day };
      news.push({ kind: "humbled", personId: p.id, name: p.name });
    }
    // rate momentum: chase the fame curve
    p.dailyRate = Math.max(C.rateFloor, Math.round(((p.dailyRate ?? C.rateFloor) + (targetRate(content, p) - (p.dailyRate ?? C.rateFloor)) * C.rateChase) / 500) * 500);
    p.netWorth = Math.round((p.netWorth ?? 0) + p.dailyRate * 20 * (tier === "smash" ? 3 : 1));
  }

  // ---- director: the reel is the résumé ----
  const dir = person(m.directorId);
  if (dir) {
    dir.avgRating = Math.round(clamp((dir.avgRating ?? 50) + ((m.quality.direction ?? 50) - (dir.avgRating ?? 50)) * C.craftDrift, 5, 100));
    if (m.actualVfx !== undefined && dir.avgVfxShots !== undefined) dir.avgVfxShots = Math.round(dir.avgVfxShots + (m.actualVfx - dir.avgVfxShots) * 0.3);
    if (dir.avgReshoots !== undefined) dir.avgReshoots = Math.max(0, Math.round((dir.avgReshoots + (messy ? 0.4 : -0.15)) * 10) / 10);
  }

  // ---- writer: craft drifts; a fusion hit stretches their range ----
  const wr = person(m.writerId);
  if (wr) {
    wr.avgRating = Math.round(clamp((wr.avgRating ?? 50) + ((m.quality.script ?? 50) - (wr.avgRating ?? 50)) * C.craftDrift, 5, 100));
    if ((tier === "smash" || tier === "hit") && m.genre2 && wr.capableGenres && !wr.capableGenres.includes(m.genre2) && rng.chance(0.5)) {
      wr.capableGenres.push(m.genre2);
      news.push({ kind: "range", personId: wr.id, name: wr.name });
    }
  }

  // ---- producer: the multipliers become EARNED ----
  const pr = person(m.producerId);
  if (pr) {
    const P = C.producer;
    pr.avgProdRevenue = clamp((pr.avgProdRevenue ?? 1) + P.revenueDelta[tier], 0.7, 1.5);
    pr.avgProdLength = clamp((pr.avgProdLength ?? 1) + (m.setbackCount >= 2 ? P.lengthSetback : P.lengthClean), 0.85, 1.3);
    pr.avgProdCost = clamp((pr.avgProdCost ?? 1) + (overran ? P.costOverrun : P.costClean), 0.8, 1.3);
    pr.avgRating = Math.round(clamp((pr.avgRating ?? 50) + ((m.quality.polish ?? 50) - (pr.avgRating ?? 50)) * C.craftDrift, 5, 100));
    if (pr.morale !== undefined) pr.morale = clamp(pr.morale + (tier === "smash" || tier === "hit" ? P.moraleHit : tier === "flop" || tier === "bomb" ? -P.moraleFlop : 1), 0, 100);
  }

  // ---- VFX studio: demand follows the trailer ----
  const vfx = state.vfxStudios.find((v) => v.id === m.vfxStudioId);
  if (vfx) {
    const V = C.vfx;
    vfx.avgRating = Math.round(clamp(vfx.avgRating + ((m.quality.vfx ?? 50) - vfx.avgRating) * V.drift, 5, 100));
    if ((tier === "smash" || tier === "hit") && (m.quality.vfx ?? 0) > 70) {
      vfx.dailyCost = Math.min(V.costCeil, vfx.dailyCost + V.demandStep);
      news.push({ kind: "vfxHot", vfxId: vfx.id, name: vfx.name });
    } else if (tier === "bomb" && (m.quality.vfx ?? 100) < 45) {
      vfx.dailyCost = Math.max(V.costFloor, vfx.dailyCost - V.demandStep);
      news.push({ kind: "vfxCold", vfxId: vfx.id, name: vfx.name });
    }
  }

  return news;
}
