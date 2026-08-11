// Audience sim: taste segments with hidden affinities, discovery, fads, and the release funnel.

import type { Rng } from "./rng";
import type { AudienceState, Content, Movie, RunState, Segment } from "./types";

export function initAudience(rng: Rng, content: Content): AudienceState {
  const A = content.audience;
  const segments: Segment[] = A.segments.map((s: any) => {
    const hidden: Record<string, number> = {};
    for (const [g, base] of Object.entries(s.genreAffinity as Record<string, number>)) {
      hidden[g] = Math.min(1, Math.max(0, base + (rng.next() - 0.5) * 0.25)); // each run's tastes differ
    }
    const genres: Record<string, any> = {};
    for (const g of Object.keys(s.genreAffinity)) genres[g] = "unknown";
    return {
      id: s.id,
      name: s.name,
      size: s.size,
      channelTheater: s.channelTheater,
      criticWeight: s.criticWeight,
      genres,
      people: {},
      studios: {},
      franchises: {},
      hiddenGenres: hidden,
    };
  });
  const fads: Record<string, number> = {};
  for (const g of Object.keys(content.pitches.genres)) fads[g] = 1;
  const topicFads: Record<string, number> = {};
  for (const t of content.pitches.topics ?? []) topicFads[t.id] = 0.85 + rng.next() * 0.4;
  return { segments, fads, topicFads };
}

/** Combined market heat for a picture: genre × genre × topic, MULTIPLICATIVE.
 *  All three tracking hot = a phenomenon. All three cold = a funeral. Boom or bust. */
export function movieHeat(content: Content, state: RunState, m: { genre: string; genre2?: string; topic?: string }): number {
  const F = content.audience.fusion ?? { heatFloor: 0.15, heatCeil: 6, g2Power: 0.8, topicPower: 1.3 };
  const f1 = state.audience.fads[m.genre] ?? 1;
  const f2 = m.genre2 ? (state.audience.fads[m.genre2] ?? 1) : 1;
  const ft = m.topic ? (state.audience.topicFads?.[m.topic] ?? 1) : 1;
  const heat = f1 * Math.pow(f2, F.g2Power) * Math.pow(ft, F.topicPower);
  return Math.max(F.heatFloor, Math.min(F.heatCeil, heat));
}

export function weeklyFadTick(rng: Rng, content: Content, aud: AudienceState) {
  const F = content.audience.fads;
  for (const g of Object.keys(aud.fads)) {
    let v = aud.fads[g];
    v += (1 - v) * F.decayPerWeek; // regress to neutral
    if (rng.chance(F.sparkChance)) v += F.spikeAmount;
    aud.fads[g] = Math.min(F.max, Math.max(F.min, v));
  }
  // topics run hotter and die faster — the boom/bust layer
  const T = content.audience.topicFads ?? F;
  aud.topicFads ??= {};
  for (const t of content.pitches.topics ?? []) aud.topicFads[t.id] ??= 1;
  for (const k of Object.keys(aud.topicFads)) {
    let v = aud.topicFads[k];
    v += (1 - v) * T.decayPerWeek;
    if (rng.chance(T.sparkChance)) v += T.spikeAmount;
    aud.topicFads[k] = Math.min(T.max, Math.max(T.min, v));
  }
}

export interface FunnelResult {
  fans: number; // millions
  reached: number;
  interested: number;
  tickets: number;
  wholesale: number;
  retail: number;
  gross: number;
  homeGross: number;
}

/** Compute a movie's opening potential; weekly grosses decay from this. */
export function computeFunnel(content: Content, state: RunState, movie: Movie, marketingReach: number): FunnelResult {
  const E = content.economy.release;
  const A = content.audience;
  const cast = movie.castIds.map((id) => state.people.find((p) => p.id === id)!).filter(Boolean);
  const fameFactor = cast.length ? cast.reduce((s, c) => s + (c.fame ?? 0), 0) / cast.length / 100 : 0.1;
  const stars = movie.reviews.length ? movie.reviews.reduce((s, r) => s + r.stars, 0) / movie.reviews.length : 2.5;
  const wom = (movie.fanScore ?? 50) / 100;

  let fans = 0,
    reached = 0,
    interested = 0,
    tickets = 0,
    homePool = 0;

  for (const seg of state.audience.segments) {
    const potential = seg.size; // millions
    const franchiseBonus = movie.franchise ? A.franchiseLoyalty * (seg.hiddenGenres[movie.genre] ?? 0.4) : 0;
    const segFans = potential * Math.min(0.6, 0.03 + fameFactor * 0.12 + franchiseBonus);
    const segReached = segFans + (potential - segFans) * marketingReach * (0.4 + movie.hype / 160);
    // fusion affinity: two genres blend; wildly mismatched pairs confuse a segment,
    // twin passions resonate
    const FU = content.audience.fusion ?? { confusionPenalty: 0.35, resonanceBonus: 0.18 };
    const a1 = seg.hiddenGenres[movie.genre] ?? 0.4;
    const a2 = movie.genre2 ? (seg.hiddenGenres[movie.genre2] ?? 0.4) : a1;
    let affinity = (a1 + a2) / 2 - Math.abs(a1 - a2) * FU.confusionPenalty;
    if (a1 > 0.6 && a2 > 0.6) affinity += FU.resonanceBonus;
    affinity = Math.max(0.03, affinity);
    const heat = movieHeat(content, state, movie);
    const criticPull = seg.criticWeight * (stars / 5) + (1 - seg.criticWeight) * wom;
    const segInterested = segReached * affinity * heat * (0.35 + criticPull * 0.75);
    const segTickets = segInterested * seg.channelTheater;
    fans += segFans;
    reached += segReached;
    interested += segInterested;
    tickets += segTickets;
    homePool += segInterested * (1 - seg.channelTheater);
  }

  const seasonIdx = Math.floor(((movie.releaseDay ?? 0) % 336) / (7 * 12));
  const seasonMod = E.seasonMods[["Winter", "Spring", "Summer", "Fall"][seasonIdx] ?? "Spring"] ?? 1;
  tickets *= seasonMod * (E.turnout ?? 1);
  homePool *= E.turnout ?? 1;

  const gross = tickets * 1e6 * E.ticketPrice;
  const wholesale = homePool * 0.18;
  const retail = wholesale * 0.55;
  return { fans, reached, interested, tickets, wholesale, retail, gross, homeGross: 0 };
}

/** Flip unknown → like/dislike when a release produces evidence. */
export function discover(content: Content, state: RunState, movie: Movie) {
  const D = content.audience.discovery;
  const stars = movie.reviews.length ? movie.reviews.reduce((s, r) => s + r.stars, 0) / movie.reviews.length : 2.5;
  const studioName = state.studios[movie.studio].name;
  for (const seg of state.audience.segments) {
    const affinity = seg.hiddenGenres[movie.genre] ?? 0.4;
    if (seg.genres[movie.genre] === "unknown") {
      seg.genres[movie.genre] = affinity >= D.likeThreshold ? "like" : affinity <= D.dislikeThreshold ? "dislike" : seg.genres[movie.genre];
    }
    const verdict: "like" | "dislike" | undefined = stars >= 3.5 ? "like" : stars <= 2 ? "dislike" : undefined;
    if (verdict) {
      seg.studios[studioName] = verdict;
      if (movie.directorId) seg.people[movie.directorId] = verdict;
      for (const c of movie.castIds) seg.people[c] = verdict;
      if (movie.franchise) seg.franchises[movie.franchise] = verdict;
    }
  }
  // saturation: a release cools its genres — and its topic HARD (booms bust themselves)
  const F = content.audience.fads;
  state.audience.fads[movie.genre] = Math.max(F.min, (state.audience.fads[movie.genre] ?? 1) - F.saturationPerRelease * 0.5);
  if (movie.genre2) state.audience.fads[movie.genre2] = Math.max(F.min, (state.audience.fads[movie.genre2] ?? 1) - F.saturationPerRelease * 0.3);
  const T = content.audience.topicFads;
  if (movie.topic && T && state.audience.topicFads) {
    state.audience.topicFads[movie.topic] = Math.max(T.min, (state.audience.topicFads[movie.topic] ?? 1) - T.saturationPerRelease);
  }
}
