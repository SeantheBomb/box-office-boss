// Mints the world's people from generator tables. Editor edits the tables, never instances.

import type { Rng } from "./rng";
import type { Content, Person, Role, VfxStudio } from "./types";

function range(rng: Rng, r: [number, number]): number {
  return r[0] + rng.next() * (r[1] - r[0]);
}
function irange(rng: Rng, r: [number, number]): number {
  return Math.round(range(rng, r));
}

let counter = 0;
function pid(role: string): string {
  return `${role}_${counter++}`;
}

export function mintName(rng: Rng, banks: any, gender: "M" | "F" | "NB", inspiration?: any): string {
  // TMDB-baked real name pools recombine into fictional people; hand-authored banks keep the cartoon end
  const insp = inspiration?.namePools;
  const useReal = insp?.first?.length > 50 && rng.chance(0.6);
  const first = useReal
    ? rng.pick(insp.first as string[])
    : gender === "M" ? rng.pick(banks.firstM as string[]) : gender === "F" ? rng.pick(banks.firstF as string[]) : rng.pick(banks.firstN as string[]);
  const last = insp?.last?.length > 50 && rng.chance(0.6) ? rng.pick(insp.last as string[]) : rng.pick(banks.last as string[]);
  return `${first} ${last}`;
}

function mintGender(rng: Rng): "M" | "F" | "NB" {
  const r = rng.next();
  return r < 0.46 ? "M" : r < 0.92 ? "F" : "NB";
}

export function mintPerson(rng: Rng, content: Content, role: Role): Person {
  const P = content.people;
  const gender = mintGender(rng);
  const base: Person = {
    id: pid(role),
    role,
    name: mintName(rng, P.nameBanks, gender, (content as any).inspiration),
    gender,
    portraitSeed: rng.int(0, 2 ** 30),
    archetype: "",
    alive: true,
    filmography: [],
    relationship: irange(rng, [-5, 15]),
    busyUntil: 0,
  };
  if (role === "cast") {
    const a = rng.pickWeighted(P.castArchetypes as any[], (t) => t.weight);
    base.archetype = a.id;
    base.avgRating = irange(rng, a.rating);
    base.cooperation = irange(rng, a.cooperation);
    base.improv = irange(rng, a.improv);
    base.dailyRate = Math.round(range(rng, a.rate) / 500) * 500;
    base.fame = irange(rng, a.fame);
    base.physique = rng.pick(P.physiques as string[]);
    base.netWorth = Math.round(base.dailyRate! * irange(rng, [80, 400]));
    base.rider = rng.pick(P.riders as string[]);
  } else if (role === "director") {
    const a = rng.pickWeighted(P.directorArchetypes as any[], (t) => t.weight);
    base.archetype = a.id;
    base.avgRating = irange(rng, a.rating);
    base.avgVfxShots = irange(rng, a.vfxShots);
    base.avgCastSize = irange(rng, a.castSize);
    base.avgLocations = irange(rng, a.locations);
    base.avgReshoots = irange(rng, a.reshoots);
    base.avgCastCooperation = irange(rng, a.castCooperation);
  } else if (role === "writer") {
    const a = rng.pickWeighted(P.writerArchetypes as any[], (t) => t.weight);
    base.archetype = a.id;
    base.avgRating = irange(rng, a.rating);
    const genres = Object.keys(content.pitches.genres);
    const n = irange(rng, a.genreCount);
    base.capableGenres = rng.shuffle([...genres]).slice(0, Math.max(1, n));
  } else if (role === "producer") {
    const a = rng.pickWeighted(P.producerArchetypes as any[], (t) => t.weight);
    base.archetype = a.id;
    base.avgProdLength = range(rng, a.length);
    base.avgProdCost = range(rng, a.cost);
    base.avgProdRevenue = range(rng, a.revenue);
    base.avgRating = irange(rng, a.rating);
  } else if (role === "agent") {
    base.archetype = rng.pick(P.agentArchetypes as string[]);
    base.avgRating = irange(rng, [40, 90]); // dealmaking bite
  } else if (role === "critic") {
    base.archetype = rng.pick(P.criticPersonas as string[]);
    base.outlet = rng.pick(P.nameBanks.outlets as string[]);
    base.harshness = 0.25 + rng.next() * 0.5;
    base.genreBias = {};
    for (const g of Object.keys(content.pitches.genres)) base.genreBias[g] = Math.round((rng.next() - 0.5) * 2 * 10) / 10;
  }
  return base;
}

export function mintVfxStudio(rng: Rng, content: Content): VfxStudio {
  const P = content.people;
  const tier = rng.pickWeighted(P.vfxTiers as any[], (t) => t.weight);
  return {
    id: pid("vfx"),
    name: `${rng.pick(P.nameBanks.vfxPrefix as string[])} ${rng.pick(P.nameBanks.vfxSuffix as string[])}`,
    dailyCost: Math.round(range(rng, tier.dailyCost) / 500) * 500,
    maxDailyShots: irange(rng, tier.maxShots),
    avgRating: irange(rng, tier.rating),
  };
}

export function mintWorld(rng: Rng, content: Content): { people: Person[]; vfxStudios: VfxStudio[] } {
  counter = 0;
  const c = content.people.counts;
  const people: Person[] = [];
  const roles: [Role, number][] = [
    ["cast", c.cast],
    ["director", c.directors],
    ["writer", c.writers],
    ["producer", c.producers],
    ["critic", c.critics],
    ["agent", c.agents ?? 6],
  ];
  const usedNames = new Set<string>();
  for (const [role, n] of roles)
    for (let i = 0; i < n; i++) {
      const p = mintPerson(rng, content, role);
      // nobody in this town shares a name — remint on collision
      for (let tries = 0; tries < 12 && usedNames.has(p.name); tries++) p.name = mintName(rng, content.people.nameBanks, p.gender, (content as any).inspiration);
      usedNames.add(p.name);
      people.push(p);
    }
  // everybody who matters is repped
  const agents = people.filter((p) => p.role === "agent");
  for (const p of people) {
    if (p.role === "cast" || p.role === "director") p.agentId = rng.pick(agents).id;
  }
  const vfxStudios: VfxStudio[] = [];
  const usedVfx = new Set<string>();
  for (let i = 0; i < c.vfx; i++) {
    const v = mintVfxStudio(rng, content);
    for (let tries = 0; tries < 12 && usedVfx.has(v.name); tries++) {
      v.name = `${rng.pick(content.people.nameBanks.vfxPrefix as string[])} ${rng.pick(content.people.nameBanks.vfxSuffix as string[])}`;
    }
    usedVfx.add(v.name);
    vfxStudios.push(v);
  }
  return { people, vfxStudios };
}
