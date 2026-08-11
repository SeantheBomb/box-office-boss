// Pitch generation: title grammars × genre tables × writer capability.

import type { Rng } from "./rng";
import type { Content, Movie, Person, RunState } from "./types";

export interface PitchData {
  title: string;
  genre: string;
  genre2?: string;
  topic?: string;
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

/** Embedding-guided word pick: candidates score by genre affinity × coherence with the
 *  anchor word (cosine-neighbor bonus from the baked SVD space) × novelty. */
// meta-words: high genre-lift in the corpus but useless as title words
const LEX_META = new Set([
  "comedy", "thriller", "horror", "drama", "western", "animation", "animated", "biography",
  "documentary", "film", "movie", "story", "sequel", "remake", "reboot", "novel", "based",
  "series", "musical", "fiction", "cinema", "feature", "genre", "adaptation", "anthology",
]);

export function lexPick(rng: Rng, content: Content, genre: string | undefined, anchor: string | undefined, exclude: Set<string>): string | undefined {
  const lex = content.lexicon;
  const pool: [string, number][] = genre ? lex?.genreWords?.[genre] ?? [] : Object.values(lex?.genreWords ?? {}).flat() as [string, number][];
  if (!pool.length) return undefined;
  const anchorNbrs: string[] = anchor ? lex.neighbors?.[anchor] ?? [] : [];
  const scored = pool
    .filter(([w]) => !exclude.has(w) && w !== anchor && !LEX_META.has(w))
    .map(([w, s]) => [w, s * (anchorNbrs.includes(w) ? 4 : 1) * (0.6 + rng.next() * 0.8)] as [string, number]);
  if (!scored.length) return undefined;
  scored.sort((a, b) => b[1] - a[1]);
  const top = scored.slice(0, 6);
  return top[rng.pickWeighted([...top.keys()], (i) => top[i][1])][0];
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** Title built from genre-coherent lexicon words when the bake is present. */
function makeTitle(rng: Rng, content: Content, genre: string | undefined, inspWords: string[], P: any): string {
  const grammar = rng.pick(P.titleGrammars as string[]);
  const used = new Set<string>();
  let anchor: string | undefined;
  return grammar.replace(/\{([\w-]+)\}/g, (_: string, key: string) => {
    if (key === "adj" || key === "noun" || key === "noun2") {
      const lexWord = rng.chance(0.75) ? lexPick(rng, content, genre, anchor, used) : undefined;
      if (lexWord) {
        used.add(lexWord);
        anchor ??= lexWord; // later slots cohere with the first
        return cap(lexWord);
      }
      if (inspWords.length > 100 && rng.chance(0.45)) return rng.pick(inspWords);
    }
    const bank = P.titleWords[key] as string[] | undefined;
    return bank ? rng.pick(bank) : key;
  });
}

export function mintTitle(rng: Rng, content: Content, state?: RunState, genre?: string): string {
  const P = content.pitches;
  const inspWords: string[] = (content as any).inspiration?.titleWords ?? [];
  const make = () => makeTitle(rng, content, genre, inspWords, P);
  // non-franchise movies never share a name — retry against every title in the world,
  // INCLUDING titles still floating around as pitches (the lexicon concentrates word
  // choices per genre, so two writers can otherwise land on the same title)
  const used = new Set([
    ...(state?.movies.map((m) => m.title.toLowerCase()) ?? []),
    ...(((state?.flags?.usedTitles as string[]) ?? []).map((t) => t.toLowerCase())),
  ]);
  let title = make();
  for (let i = 0; i < 30 && used.has(title.toLowerCase()); i++) title = make();
  if (used.has(title.toLowerCase())) title = `${title} (${rng.int(2, 99)})`; // pathological fallback
  return title.replace(/\bA ([AEIOU])/g, "An $1"); // article agreement
}

export function mintPitch(rng: Rng, content: Content, state: RunState, writer: Person, forStudio: number): PitchData {
  const P = content.pitches;
  const genres = writer.capableGenres && writer.capableGenres.length ? writer.capableGenres : Object.keys(P.genres);
  // writers chase fads a bit
  const genre = rng.pickWeighted(genres, (g) => (state.audience.fads[g] ?? 1) ** 2);
  const G = P.genres[genre];
  // FUSION: a second genre (writers chase what's tracking) + a tracked topic
  const allGenres = Object.keys(P.genres).filter((g) => g !== genre);
  const genre2 = rng.pickWeighted(allGenres, (g) => (state.audience.fads[g] ?? 1) ** 1.5);
  const topics: any[] = P.topics ?? [];
  const topicDef = topics.length
    ? rng.pickWeighted(topics, (t) => ((state.audience.topicFads?.[t.id] ?? 1) ** 1.5) * (t.genres?.includes(genre) || t.genres?.includes(genre2) ? 2.2 : 0.7))
    : undefined;
  const subgenre = topicDef?.label ?? rng.pick(G.subgenres as string[]);
  const budgetSpan = G.budget as [number, number];
  const minBudget = Math.round((budgetSpan[0] + rng.next() * (budgetSpan[1] - budgetSpan[0])) / 250000) * 250000;
  const directors = state.people.filter((p) => p.role === "director" && p.alive);
  const cast = state.people.filter((p) => p.role === "cast" && p.alive);
  const idealDirector = rng.pick(directors);
  const idealCast = rng.shuffle([...cast]).slice(0, 2);
  const theme1 = rng.pick(P.themes as string[]);
  let theme2 = rng.pick(P.themes as string[]);
  if (theme2 === theme1) theme2 = rng.pick(P.themes as string[]);
  const seeds: string[] = (content as any).inspiration?.loglineSeeds ?? [];
  const phrases: string[] = content.lexicon?.keywordPhrases?.[genre] ?? [];
  let logline: string;
  if (phrases.length > 20 && rng.chance(0.45)) {
    // genre-true concept collision, built from TMDB's curated keyword space
    const art = (w: string) => (w.includes(" ") || /s$/.test(w) ? w : `${/^[aeiou]/.test(w) ? "an" : "a"} ${w}`);
    const p1 = rng.pick(phrases.slice(0, 60));
    let p2 = rng.pick(phrases.slice(0, 60));
    for (let i = 0; i < 5 && (p2 === p1 || p2.split(" ")[0] === p1.split(" ")[0]); i++) p2 = rng.pick(phrases);
    logline = rng.pick([
      `${art(p1)} story that collides head-on with ${art(p2)}`,
      `${art(p1)}, except the real problem is ${art(p2)}`,
      `what starts as ${art(p1)} curdles into ${art(p2)}`,
      `they signed up for ${art(p1)}. Nobody mentioned ${art(p2)}`,
      `equal parts ${p1} and ${p2}, holding hands off a cliff`,
    ]);
  } else if (seeds.length > 50 && rng.chance(0.4)) {
    // a real movie's premise, straight-faced, as if it were brand new
    logline = rng.pick(seeds).replace(/\.$/, "").toLowerCase();
    logline = logline.charAt(0) + logline.slice(1);
  } else {
    const frame = rng.pick(P.loglineFrames as string[]);
    logline = frame
      .replace("{theme1}", theme1)
      .replace("{theme2}", theme2)
      .replace("{setPiece}", rng.pick(P.setPieces as string[]));
  }
  // comps sell pictures: name-drop two real movies when the bake is present
  const realTitles: string[] = (content as any).inspiration?.titles ?? [];
  if (realTitles.length > 100 && rng.chance(0.5)) {
    const a = rng.pick(realTitles);
    let b = rng.pick(realTitles);
    if (b === a) b = rng.pick(realTitles);
    logline += `. It's ${a} meets ${b}`;
  }
  const title = mintTitle(rng, content, state, genre);
  if (state) {
    const ut: string[] = ((state.flags as any).usedTitles ??= []);
    ut.push(title);
    if (ut.length > 250) ut.shift();
  }
  const titleWords = title.replace(/[^a-zA-Z\s]/g, "").split(/\s+/).filter((w) => w.length > 3);
  // the hook IS the pitch: subject lines derive from what's actually being sold
  const hook = rng.pick([subgenre.toUpperCase(), theme1.toUpperCase(), ...(titleWords.length ? [rng.pick(titleWords).toUpperCase()] : [])]);
  return {
    title,
    genre,
    genre2,
    topic: topicDef?.id,
    subgenre,
    estRating: rng.pick(G.ratings as string[]),
    targetLength: Math.round(G.length[0] + rng.next() * (G.length[1] - G.length[0])),
    minBudget,
    estVfx: Math.round(G.vfx[0] + rng.next() * (G.vfx[1] - G.vfx[0])),
    hook,
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
    genre2: parent.genre2,
    topic: parent.topic,
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
