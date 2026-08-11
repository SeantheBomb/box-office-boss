// Pitch generation: title grammars × genre tables × writer capability.

import type { Rng } from "./rng";
import type { Content, Movie, Person, RunState } from "./types";

export interface PitchData {
  title: string;
  genre: string;
  subgenre: string;
  estRating: string;
  targetLength: number;
  minBudget: number;
  estVfx: number;
  hook: string;
  logline: string;
  franchise?: string;
  sequelOf?: string;
  idealDirectorId?: string;
  idealCastIds: string[];
}

export function mintTitle(rng: Rng, content: Content, state?: RunState): string {
  const P = content.pitches;
  const inspWords: string[] = (content as any).inspiration?.titleWords ?? [];
  const make = () => {
    const grammar = rng.pick(P.titleGrammars as string[]);
    return grammar.replace(/\{([\w-]+)\}/g, (_, key) => {
      const bank = P.titleWords[key] as string[] | undefined;
      // TMDB-harvested words blend into adj/noun slots for variety
      if ((key === "adj" || key === "noun" || key === "noun2") && inspWords.length > 100 && rng.chance(0.45)) return rng.pick(inspWords);
      return bank ? rng.pick(bank) : key;
    });
  };
  // non-franchise movies never share a name — retry against every title in the world
  const used = new Set(state?.movies.map((m) => m.title.toLowerCase()) ?? []);
  let title = make();
  for (let i = 0; i < 30 && used.has(title.toLowerCase()); i++) title = make();
  if (used.has(title.toLowerCase())) title = `${title} (${rng.int(2, 99)})`; // pathological fallback
  return title;
}

export function mintPitch(rng: Rng, content: Content, state: RunState, writer: Person, forStudio: number): PitchData {
  const P = content.pitches;
  const genres = writer.capableGenres && writer.capableGenres.length ? writer.capableGenres : Object.keys(P.genres);
  // writers chase fads a bit
  const genre = rng.pickWeighted(genres, (g) => (state.audience.fads[g] ?? 1) ** 2);
  const G = P.genres[genre];
  const subgenre = rng.pick(G.subgenres as string[]);
  const budgetSpan = G.budget as [number, number];
  const minBudget = Math.round((budgetSpan[0] + rng.next() * (budgetSpan[1] - budgetSpan[0])) / 250000) * 250000;
  const directors = state.people.filter((p) => p.role === "director" && p.alive);
  const cast = state.people.filter((p) => p.role === "cast" && p.alive);
  const idealDirector = rng.pick(directors);
  const idealCast = rng.shuffle([...cast]).slice(0, 2);
  const theme1 = rng.pick(P.themes as string[]);
  let theme2 = rng.pick(P.themes as string[]);
  if (theme2 === theme1) theme2 = rng.pick(P.themes as string[]);
  const frame = rng.pick(P.loglineFrames as string[]);
  let logline = frame
    .replace("{theme1}", theme1)
    .replace("{theme2}", theme2)
    .replace("{setPiece}", rng.pick(P.setPieces as string[]));
  // comps sell pictures: name-drop two real movies when the bake is present
  const realTitles: string[] = (content as any).inspiration?.titles ?? [];
  if (realTitles.length > 100 && rng.chance(0.5)) {
    const a = rng.pick(realTitles);
    let b = rng.pick(realTitles);
    if (b === a) b = rng.pick(realTitles);
    logline += `. It's ${a} meets ${b}`;
  }
  return {
    title: mintTitle(rng, content, state),
    genre,
    subgenre,
    estRating: rng.pick(G.ratings as string[]),
    targetLength: Math.round(G.length[0] + rng.next() * (G.length[1] - G.length[0])),
    minBudget,
    estVfx: Math.round(G.vfx[0] + rng.next() * (G.vfx[1] - G.vfx[0])),
    hook: rng.pick(P.titleWords.hookNoun as string[]),
    logline,
    idealDirectorId: idealDirector?.id,
    idealCastIds: idealCast.map((c) => c.id),
  };
}

export function mintSequelPitch(rng: Rng, content: Content, state: RunState, parent: Movie): PitchData {
  const P = content.pitches;
  const G = P.genres[parent.genre];
  const sub = rng.pick(P.sequelSubtitles as string[]);
  const baseTitle = parent.title.replace(/ (II|2:.*|Returns|Resurrection|Forever)$/, "");
  return {
    title: `${baseTitle} ${sub}`,
    genre: parent.genre,
    subgenre: parent.subgenre,
    estRating: parent.estRating,
    targetLength: parent.targetLength,
    minBudget: Math.round(parent.budget * 1.2),
    estVfx: Math.round((parent.actualVfx ?? parent.estVfx) * 1.15),
    hook: "SEQUEL",
    logline: "same, but more, and this time it's personal",
    franchise: parent.franchise ?? baseTitle,
    sequelOf: parent.id,
    idealDirectorId: parent.directorId,
    idealCastIds: parent.castIds.slice(0, 2),
  };
}
