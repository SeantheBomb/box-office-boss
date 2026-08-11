// Persona voices + memory weaving: every person speaks in one voice forever, and
// remembers what you did. The single biggest variety multiplier in the game —
// the same bank line decorated by two different voices reads as two different humans.

import { makeRng, type Rng } from "./rng";
import type { Content, Person, Voice, Memory } from "./types";

const TONES: Voice["tone"][] = ["warm", "sharp", "anxious", "grandiose"];

/** Deterministic from portraitSeed — a person's voice never changes across saves. */
export function mintVoice(content: Content, person: Person): Voice {
  if (person.voice) return person.voice;
  const rng = makeRng(person.portraitSeed ^ 0x5eed);
  const V = content.voices;
  // archetype leans the tone: divas go grandiose, workhorses warm, agents sharp
  const lean: Record<string, Voice["tone"]> = {
    "method-perfectionist": "grandiose", "faded-legend": "grandiose", "loose-cannon": "grandiose",
    "bankable-star": "warm", workhorse: "warm", "rising-talent": "anxious",
    shark: "sharp", "velvet-glove": "warm", "up-and-comer": "anxious", "unnervingly-calm": "sharp",
    "penny-pincher": "sharp", "prestige-producer": "grandiose", "hype-machine": "warm",
    acid: "sharp", contrarian: "sharp", gushing: "warm", academic: "grandiose",
  };
  const tone = rng.chance(0.6) && lean[person.archetype] ? lean[person.archetype] : rng.pick(TONES);
  const domains = Object.keys(V.metaphorDomains);
  const voice: Voice = {
    tone,
    metaphorDomain: rng.pick(domains),
    catchphrase: rng.pick(V.catchphrases[tone] as string[]),
    signoff: rng.pick(V.signoffs[tone] as string[]),
    verbosity: rng.pick(["terse", "normal", "normal", "florid"] as const),
  };
  person.voice = voice;
  return voice;
}

/** Decorate an email body in the speaker's voice: catchphrase opener, a metaphor from
 *  their pet domain, their signature sign-off. Deterministic per (person, day). */
export function voiceWrap(content: Content, person: Person, body: string, day: number): string {
  const v = mintVoice(content, person);
  const rng = makeRng((person.portraitSeed ^ (day * 2654435761)) >>> 0);
  let out = body;
  if (rng.chance(0.65)) out = `${v.catchphrase} ${out}`;
  if (rng.chance(0.4)) {
    const lines = content.voices.metaphorDomains[v.metaphorDomain] as string[];
    out = `${out}\n(${lines[rng.int(0, lines.length - 1)].replace(/^\w/, (c) => c.toUpperCase())}.)`;
  }
  if (v.verbosity === "terse") out = out.replace(/\n\(.*\)$/, ""); // terse people skip the flourish
  out = `${out}\n${v.signoff}`;
  return out;
}

/** A dialogue line, flavored: grandiose people italicize themselves, anxious trail off. */
export function voiceLine(content: Content, person: Person, line: string, rng: Rng): string {
  const v = mintVoice(content, person);
  if (v.tone === "anxious" && rng.chance(0.3)) return line.replace(/\.$/, "…");
  if (v.tone === "grandiose" && rng.chance(0.25)) return `${line} You may quote me.`;
  if (v.tone === "sharp" && rng.chance(0.25)) return line.replace(/\.$/, ". Next.");
  return line;
}

// ---------------- memory ----------------

export function remember(person: Person, day: number, text: string, delta: number) {
  (person.memories ??= []).push({ day, text, delta });
  if (person.memories.length > 8) person.memories.shift();
}

/** Weave the past into the present: pulls this person's strongest memory of you, or a
 *  filmography beat, for openers like "After what happened with the parrot…" */
export function callbackLine(person: Person, day: number, rng: Rng): string | undefined {
  const mems = (person.memories ?? []).filter((m) => day - m.day < 336);
  if (mems.length && rng.chance(0.7)) {
    const m = mems.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    return m.delta >= 0
      ? rng.pick([
          `I haven't forgotten that ${m.text}. Counts for a lot in this town.`,
          `You were good to me when ${m.text}. I keep score, favorably.`,
          `Ever since ${m.text}, I tell people you're one of the decent ones.`,
        ])
      : rng.pick([
          `I remember when ${m.text}. I'm choosing to rise above it. Publicly.`,
          `We both know ${m.text}. Moving on. Mostly.`,
          `After ${m.text}, my therapist knows your name. Anyway.`,
        ]);
  }
  const flop = person.filmography?.filter((f) => f.profit < 0).pop();
  if (flop && rng.chance(0.4)) return `And before you bring up ${flop.title} — we don't bring up ${flop.title}.`;
  const hit = person.filmography?.filter((f) => f.profit > 0 && f.stars >= 3.5).pop();
  if (hit && rng.chance(0.4)) return `${hit.title} bought my house, so you know I deliver.`;
  return undefined;
}
