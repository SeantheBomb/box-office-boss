// Bump BUILD_VERSION every deploy; players get a studio-memo popup with the changelog.
// SAVE_VERSION lives in kernel/save.ts — when it bumps, the popup explains the save reset.

export const BUILD_VERSION = "0.5.0";

export const CHANGELOG: string[] = [
  "THE WRITING OVERHAUL: meetings are now real conversations — read their mood at the door, schmooze at your own risk (their personality decides what lands), then get down to business and haggle the fine print.",
  "RAPPORT & TELLS: a visible needle and body-language reads track how the room feels. A worn-out counterpart can walk on a full-price offer; a charmed one forgives a lowball.",
  "INTEL & LEVERAGE: lunches and the new Whisper Column bank intel you can SPEND in meetings — gossip in the schmooze, hardball at the table. Locked options show you exactly what you're missing. (The gossip columnist is sometimes wrong. Find out the hard way.)",
  "CONTRACTS WITH TEETH: deals close with real clauses — backend points, sequel options, script approval — tracked as promises the game collects on later. Break one and the whole town hears.",
  "THEY REMEMBER: everyone keeps a memory of what you did — greenlights, lowballs, turned-over phones — and it colors every future greeting, email, and negotiation. Your studio now has a town-wide reputation (pays well / on time / prestige / loyalty) that opens and closes doors.",
  "EVERY VOICE ITS OWN: each person now has a permanent voice — catchphrase, sign-off, pet metaphor, tone — across every email and meeting. Trade coverage carries real columnist bylines; board memos, trade clippings, and handwritten diva notes each get their own stationery.",
  "SMARTER WORDS: a vector embedding trained on 1,350 TMDB films now drives titles, loglines, and pitches — genre-true words that cohere with each other, real-keyword premise collisions, and 80+ new bank lines with seasonal variants.",
  "OPTIONAL: ⏱ Timed choices for tense moments (Telltale mode) — toggle in the Desk Drawer.",
];
