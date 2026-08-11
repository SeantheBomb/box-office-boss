// Gemini image bake — READY BUT DORMANT: the current GEMINI_KEY project has no image
// quota (free tier limit 0). Enable billing on the Google project (or swap the key in
// .dev.vars) and run:  node tools/bake-images.mjs
//
// What it bakes (public/img/**, ~$0.04/image via gemini-2.5-flash-image):
//   bases/       24 caricature busts (consistent framing via style-reference chaining)
//   accessories/ 18 overlay props on magenta for chroma-keying (berets, monocles, earpieces…)
//   wallpapers/  6 desktop wallpapers (replace the CSS gradient set)
//   icons/       6 Mac-style squircle app icons
//   scenes/      5 meeting backdrops (meeting room, set, con stage, gala, office)
// Idempotent: existing files are skipped. A manifest.json records everything baked.
// Runtime wiring: portraits2.tsx swaps to layered <img> composites when
// public/img/manifest.json exists — same stat→trait mapping, higher fidelity.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = readFileSync(join(root, ".dev.vars"), "utf8").match(/GEMINI_KEY=(\S+)/)?.[1];
if (!KEY) throw new Error("GEMINI_KEY not found in .dev.vars");
const OUT = join(root, "public", "img");
for (const d of ["bases", "accessories", "wallpapers", "icons", "scenes"]) mkdirSync(join(OUT, d), { recursive: true });

const STYLE =
  "Stylized caricature illustration, bold confident shapes, warm painterly shading, slightly exaggerated features, " +
  "cinematic golden-hour palette, clean edges, no text, no watermark.";
const FRAME = "Bust portrait: head and shoulders only, subject facing slightly left, centered, flat warm cream background (#f4eee2), square composition.";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let styleRef = null; // first successful base becomes the style anchor for everything after
let made = 0, skipped = 0, failed = 0;

async function gen(prompt, dest, label, useRef = true) {
  if (existsSync(dest)) { skipped++; return; }
  const parts = [];
  if (useRef && styleRef) {
    parts.push({ inlineData: { mimeType: "image/png", data: styleRef } });
    parts.push({ text: `Match the art style of the reference image exactly. ${prompt}` });
  } else {
    parts.push({ text: prompt });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent", {
        method: "POST",
        headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"] } }),
      });
      if (res.status === 429) {
        const body = await res.text();
        if (/limit: 0/.test(body)) {
          console.log("\n✖ Image quota is 0 — enable billing on the Google project, then rerun.");
          process.exit(1);
        }
        await sleep(8000 * (attempt + 1));
        continue;
      }
      const j = await res.json();
      const img = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (!img) { failed++; console.log(`\n✖ ${label}: no image in response`); return; }
      writeFileSync(dest, Buffer.from(img.inlineData.data, "base64"));
      if (!styleRef) styleRef = img.inlineData.data;
      made++;
      process.stdout.write(`\r✔ ${label}                    `);
      await sleep(600);
      return;
    } catch {
      await sleep(3000 * (attempt + 1));
    }
  }
  failed++;
}

// ---- 24 base busts: gender x age x skin spread, hair baked into the base ----
const GENDERS = ["woman", "man"];
const AGES = ["young", "middle-aged", "older"];
const LOOKS = [
  "light skin, dark slicked hair",
  "medium skin, wavy shoulder-length hair",
  "deep brown skin, short natural curls",
  "olive skin, gray-streaked hair",
];
let bi = 0;
for (const g of GENDERS)
  for (const a of AGES)
    for (const l of LOOKS) {
      await gen(`${STYLE} ${FRAME} A ${a} Hollywood ${g}, ${l}, neutral-pleasant expression, plain dark clothing.`, join(OUT, "bases", `base_${bi}.png`), `bases/base_${bi}`);
      bi++;
    }

// ---- accessory overlays on magenta (chroma-key at composite time) ----
const ACCESSORIES = [
  ["beret", "a black artist beret, tilted"],
  ["headphones", "large black studio headphones"],
  ["monocle", "a gold monocle with hanging chain"],
  ["glasses", "round tortoiseshell glasses"],
  ["sunglasses", "gold-rimmed black sunglasses"],
  ["earpiece", "a modern bluetooth earpiece, blue LED"],
  ["pencil", "a yellow pencil (as if tucked behind an ear)"],
  ["scarf", "a draped burgundy silk scarf"],
  ["bowtie", "a crimson bowtie"],
  ["chain", "a chunky gold necklace chain"],
  ["earrings", "large gold hoop earrings"],
  ["cigar", "an unlit cigar"],
  ["fedora", "a classic gray fedora hat"],
  ["turban_towel", "a spa towel wrapped like a turban"],
  ["press_badge", "a laminated press badge on a lanyard"],
  ["clipboard", "a wooden clipboard with papers"],
  ["quill", "an ornate writing quill"],
  ["visor", "a green accountant's visor"],
];
for (const [name, desc] of ACCESSORIES) {
  await gen(
    `${STYLE} Product illustration of ${desc}, floating, centered, sized and angled to fit a bust portrait facing slightly left, on a SOLID PURE MAGENTA background (#FF00FF), nothing else in frame.`,
    join(OUT, "accessories", `${name}.png`),
    `accessories/${name}`
  );
}

// ---- wallpapers ----
const WALLPAPERS = [
  ["dusk", "a movie studio backlot at dusk, sound stages silhouetted, warm orange-purple sky"],
  ["golden", "rolling california hills at golden hour, a film crew tiny in the distance"],
  ["midnight", "a movie premiere at night from above, searchlights sweeping a deep blue sky"],
  ["palm", "palm trees silhouetted against a noir sunset, hollywood sign far away"],
  ["teal", "an art-deco movie palace facade in teal and gold, evening"],
  ["champagne", "abstract champagne bokeh and film reels, warm cream and gold"],
];
for (const [name, desc] of WALLPAPERS) {
  await gen(`Beautiful desktop wallpaper, 16:9, painterly cinematic style: ${desc}. No text.`, join(OUT, "wallpapers", `${name}.png`), `wallpapers/${name}`, false);
}

// ---- app icons ----
const ICONS = [
  ["mail", "a cream envelope sealed with a gold star"],
  ["calendar", "a desk calendar page with a gold star on the date"],
  ["board", "a film clapperboard"],
  ["standings", "a rising gold line chart"],
  ["audience", "three theater seats, one lit by a spotlight"],
  ["drawer", "a wooden desk drawer slightly open"],
];
for (const [name, desc] of ICONS) {
  await gen(`macOS app icon, rounded square (squircle), glossy, ${desc}, rich colors, no text.`, join(OUT, "icons", `${name}.png`), `icons/${name}`, false);
}

// ---- meeting scene backdrops ----
const SCENES = [
  ["meetingRoom", "an executive meeting room with a long mahogany table, floor-to-ceiling windows over a studio lot, empty chairs"],
  ["stage", "a busy film soundstage interior with lighting rigs, a half-built set, cinematic haze"],
  ["conStage", "a convention hall main stage from the podium's view, large excited crowd in the dark, purple stage lighting"],
  ["dinner", "an elegant awards gala ballroom, round tables with candles, a stage with gold curtains, bokeh"],
  ["office", "a movie executive's corner office at dusk, mahogany desk, awards on shelves, window over the studio lot"],
];
for (const [name, desc] of SCENES) {
  await gen(`Wide cinematic background illustration, 16:9, painterly, atmospheric: ${desc}. Empty of people in the foreground. No text.`, join(OUT, "scenes", `${name}.png`), `scenes/${name}`, false);
}

writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify(
    {
      _generated: new Date().toISOString(),
      bases: bi,
      accessories: ACCESSORIES.map(([n]) => n),
      wallpapers: WALLPAPERS.map(([n]) => n),
      icons: ICONS.map(([n]) => n),
      scenes: SCENES.map(([n]) => n),
    },
    null,
    2
  )
);
console.log(`\nDone: ${made} baked, ${skipped} skipped, ${failed} failed.`);
