// ElevenLabs audio bake: SFX, ambience loops, music beds (Music API), and
// Animal-Crossing-style mumble syllable banks. Idempotent — existing files are skipped.
// Key comes from .dev.vars (gitignored). Usage: node tools/bake-audio.mjs [--force]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = readFileSync(join(root, ".dev.vars"), "utf8").match(/ELEVENLABS_KEY=(\S+)/)?.[1];
if (!KEY) throw new Error("ELEVENLABS_KEY not found in .dev.vars");
const FORCE = process.argv.includes("--force");
const OUT = join(root, "public", "audio");
for (const d of ["sfx", "ambience", "music", "mumbles"]) mkdirSync(join(OUT, d), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let made = 0, skipped = 0, failed = 0;

async function post(url, body, dest, label) {
  if (existsSync(dest) && !FORCE) { skipped++; return true; }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
      if (!res.ok) {
        console.log(`\n✖ ${label}: ${res.status} ${(await res.text()).slice(0, 160)}`);
        failed++;
        return false;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(dest, buf);
      made++;
      process.stdout.write(`\r✔ ${label} (${Math.round(buf.length / 1024)}kb)          `);
      await sleep(400);
      return true;
    } catch (e) {
      await sleep(2000 * (attempt + 1));
    }
  }
  console.log(`\n✖ ${label}: gave up`);
  failed++;
  return false;
}

const sfxGen = (text, duration, file) =>
  post("https://api.elevenlabs.io/v1/sound-generation", { text, duration_seconds: duration, prompt_influence: 0.6 }, join(OUT, "sfx", file), `sfx/${file}`);
const ambGen = (text, file) =>
  post("https://api.elevenlabs.io/v1/sound-generation", { text, duration_seconds: 22, prompt_influence: 0.5 }, join(OUT, "ambience", file), `ambience/${file}`);
const musicGen = (prompt, ms, file) =>
  post("https://api.elevenlabs.io/v1/music", { prompt, music_length_ms: ms }, join(OUT, "music", file), `music/${file}`);

// ---------------- SFX ----------------
const SFX = [
  ["click", "single soft UI click, clean minimal interface tap, short", 0.6],
  ["window_open", "quick soft whoosh pop, interface window opening, pleasant, short", 0.7],
  ["window_close", "quick soft whoosh down, interface window closing, subtle, short", 0.6],
  ["email", "warm two-note mail notification chime, glassy, pleasant, apple-like", 1.2],
  ["reminder", "gentle calendar reminder bell, soft marimba double tap", 1.2],
  ["meeting", "short elegant string sting, someone important enters the room, anticipation", 1.8],
  ["cash", "cash register cha-ching with coin shimmer, satisfying, short", 1.2],
  ["success", "short warm success jingle, three ascending marimba notes, tasteful", 1.5],
  ["failure", "short descending sad trombone-like womp, comedic but subtle", 1.5],
  ["applause", "small theater audience applause burst with a few whistles", 3.0],
  ["camera", "rapid paparazzi camera shutter clicks and flashes", 1.8],
  ["dock_bounce", "tiny rubbery boing bounce, playful, very short", 0.5],
  ["toast", "single soft notification pop, bubble pop, subtle", 0.5],
  ["typewriter", "three quick typewriter key strikes, vintage", 0.8],
  ["phone", "short old hollywood desk telephone ring, single ring", 1.5],
  ["stamp", "heavy rubber stamp thump on paper, decisive, short", 0.7],
];

// ---------------- ambience (22s seamless loops) ----------------
const AMBIENCE = [
  ["office", "quiet executive office room tone, distant typing, occasional page turn, soft air conditioning hum, calm, seamless loop"],
  ["meetingRoom", "quiet corporate meeting room amblence, subtle air hum, occasional chair creak and pen click, seamless loop"],
  ["stage", "film set ambience, distant crew murmur, equipment being moved, walkie talkie squelch far away, seamless loop"],
  ["conStage", "convention hall ambience, large excited crowd murmur, distant announcements, seamless loop"],
  ["dinner", "elegant gala dinner ambience, clinking glasses, refined crowd chatter, occasional soft laughter, seamless loop"],
];

// ---------------- music beds (60s, loopable) ----------------
const MUSIC = [
  ["office", "soft warm lo-fi lounge jazz, gentle brushed drums, mellow piano and upright bass, background music for working, calm and classy, seamless loop, instrumental"],
  ["meetingRoom", "quiet tense minimal jazz noir, sparse piano, muted trumpet, soft brushes, negotiation mood, understated, seamless loop, instrumental"],
  ["stage", "playful light pizzicato strings and vibraphone, behind-the-scenes movie magic feeling, gentle momentum, seamless loop, instrumental"],
  ["conStage", "upbeat swing jazz, energetic but background level, showbiz razzle, seamless loop, instrumental"],
  ["dinner", "elegant slow ballroom jazz, romantic piano and soft saxophone, golden age hollywood gala, seamless loop, instrumental"],
];

// ---------------- mumbles (TTS gibberish, per voice x sentiment x variant) ----------------
const VOICES = {
  f1: "21m00Tcm4TlvDq8ikWAM", // Rachel — warm
  f2: "AZnzlk1XvdvUeBnXmlld", // Domi — sharp
  f3: "EXAVITQu4vr4xnSDxMaL", // Bella — soft
  m1: "ErXwobaYiN019PkySvjV", // Antoni — smooth
  m2: "TxGEqnHWrfWFTfGW9XjX", // Josh — deep
  m3: "pNInz6obpgDQGcFmaJgB", // Adam — gravel
};
const MUMBLE_TEXT = {
  happy: ["Ba-dee-da! Mm-hm!", "Ooh! Da-doo-da!", "Mm! Ba-da-bee!"],
  neutral: ["Hmm, ba-da mm-da.", "Mm-hm. Da-doo.", "Bah-dum, hm-mm."],
  grumpy: ["Mmph. Nn-nnh.", "Hmph! Ba-dah...", "Nnn. Mm-mph."],
};

const mumbleGen = (voiceKey, voiceId, sentiment, i, text) =>
  post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.35, similarity_boost: 0.6, speed: 1.15 },
    },
    join(OUT, "mumbles", `${voiceKey}_${sentiment}_${i}.mp3`),
    `mumbles/${voiceKey}_${sentiment}_${i}`
  );

// ---------------- run ----------------
console.log("Baking audio (idempotent — reruns only fetch missing files)…");
for (const [name, prompt, dur] of SFX) await sfxGen(prompt, dur, `${name}.mp3`);
for (const [name, prompt] of AMBIENCE) await ambGen(prompt, `${name}.mp3`);
let musicOk = true;
for (const [name, prompt] of MUSIC) {
  const ok = await musicGen(prompt, 60000, `${name}.mp3`);
  if (!ok) musicOk = false;
}
for (const [vk, vid] of Object.entries(VOICES)) {
  for (const [sent, texts] of Object.entries(MUMBLE_TEXT)) {
    for (let i = 0; i < texts.length; i++) await mumbleGen(vk, vid, sent, i, texts[i]);
  }
}

const manifest = {
  sfx: Object.fromEntries(SFX.map(([n]) => [n, `/audio/sfx/${n}.mp3`])),
  ambience: Object.fromEntries(AMBIENCE.map(([n]) => [n, `/audio/ambience/${n}.mp3`])),
  music: musicOk ? Object.fromEntries(MUSIC.map(([n]) => [n, `/audio/music/${n}.mp3`])) : {},
  mumbles: Object.fromEntries(
    Object.keys(VOICES).map((vk) => [
      vk,
      Object.fromEntries(Object.keys(MUMBLE_TEXT).map((s) => [s, MUMBLE_TEXT[s].map((_, i) => `/audio/mumbles/${vk}_${s}_${i}.mp3`)])),
    ])
  ),
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\nDone: ${made} baked, ${skipped} skipped, ${failed} failed. Manifest written.`);
