// TMDB lexicon bake: trains a small co-occurrence embedding (PPMI + SVD via power
// iteration, pure JS) over movies + their curated keywords + taglines, then ships the
// useful projections as content/lexicon.json:
//   genreWords[genre]     — title-suitable words ranked by genre affinity
//   neighbors[word]       — top coherent partner words (cosine in embedding space)
//   keywordPhrases[genre] — human-curated concept tags per genre ("heist gone wrong")
//   taglines[genre]       — real taglines, for pitch-hook voice
// Runtime generation then picks words by (genre fit × coherence × novelty) — procedural
// selection, not random. Usage: node tools/bake-lexicon.mjs   (idempotent-ish, ~10 min)

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = readFileSync(join(root, ".dev.vars"), "utf8").match(/TMDB_TOKEN=(\S+)/)?.[1] ??
  readFileSync("C:/Users/SeanF/Documents/FantasyBoxOffice/.dev.vars", "utf8").match(/TMDB_TOKEN=(\S+)/)?.[1];
const API_KEY = Buffer.from(TOKEN.split(".")[1], "base64").toString().match(/"aud":"([a-f0-9]+)"/)[1];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, params = {}, attempt = 0) => {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", API_KEY);
  try {
    const res = await fetch(url);
    if (res.status === 429) { await sleep(1500); return api(path, params, attempt); }
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt < 3) { await sleep(1000 * (attempt + 1)); return api(path, params, attempt + 1); }
    throw e;
  }
};

// our 8 in-game genres ← TMDB genre ids
const GENRES = {
  Action: [28, 12],
  Comedy: [35, 10749],
  Horror: [27],
  Drama: [18, 36],
  "Sci-Fi": [878],
  Thriller: [53, 80, 9648],
  Family: [10751, 16, 14],
  Western: [37],
};
const GENRE_OF = {};
for (const [g, ids] of Object.entries(GENRES)) for (const id of ids) GENRE_OF[id] ??= g;

// ---------------- 1. collect corpus ----------------
console.log("Collecting movies per genre…");
const movies = new Map(); // id -> {title, overview, genres[], tagline?, keywords[]}
for (const [genre, ids] of Object.entries(GENRES)) {
  for (let page = 1; page <= 12; page++) {
    const res = await api("/discover/movie", {
      with_genres: ids[0],
      sort_by: "vote_count.desc",
      page,
      "vote_count.gte": 200,
    });
    for (const m of res.results) {
      if (!m.title || /[^\x00-\x7F]/.test(m.title) || movies.has(m.id)) continue;
      movies.set(m.id, {
        title: m.title,
        overview: m.overview ?? "",
        genres: (m.genre_ids ?? []).map((i) => GENRE_OF[i]).filter(Boolean),
      });
    }
    await sleep(40);
  }
  process.stdout.write(`\r${genre}: corpus ${movies.size}   `);
}
console.log(`\nCorpus: ${movies.size} movies`);

// details (tagline) + keywords for a strong sample
const ids = [...movies.keys()];
const sample = ids.slice(0, 1400);
console.log(`Fetching details+keywords for ${sample.length}…`);
let done = 0;
for (const id of sample) {
  const [det, kw] = await Promise.all([
    api(`/movie/${id}`).catch(() => null),
    api(`/movie/${id}/keywords`).catch(() => null),
  ]);
  const m = movies.get(id);
  if (det?.tagline && !/[^\x00-\x7F]/.test(det.tagline)) m.tagline = det.tagline;
  if (kw?.keywords) m.keywords = kw.keywords.map((k) => k.name).filter((k) => !/[^\x00-\x7F]/.test(k)).slice(0, 12);
  if (++done % 100 === 0) process.stdout.write(`\r${done}/${sample.length}`);
  await sleep(25);
}
console.log();

// ---------------- 2. tokenize & vocab ----------------
const STOP = new Set(
  "the a an of and or in on to for with at from by is are was were be been his her their its this that they them he she it as but not no one two after when who what while where will can into out up down over under new old more most all some other own same about against between during before above below again once only very just also".split(" ")
);
const tok = (s) => (s ?? "").toLowerCase().replace(/[^a-z\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

const docs = []; // {tokens:Set, genres[]}
const titleWords = new Map(); // word -> count (title/keyword provenance = title-suitable)
for (const m of movies.values()) {
  const tTok = tok(m.title);
  const kTok = (m.keywords ?? []).flatMap((k) => tok(k));
  const oTok = tok(m.overview).slice(0, 40);
  for (const w of [...tTok, ...kTok]) titleWords.set(w, (titleWords.get(w) ?? 0) + 1);
  docs.push({ tokens: new Set([...tTok, ...kTok, ...oTok]), genres: m.genres });
}
// vocab: words appearing in >= 6 docs, capped
const df = new Map();
for (const d of docs) for (const w of d.tokens) df.set(w, (df.get(w) ?? 0) + 1);
const vocab = [...df.entries()].filter(([, c]) => c >= 6).sort((a, b) => b[1] - a[1]).slice(0, 2400).map(([w]) => w);
const widx = new Map(vocab.map((w, i) => [w, i]));
const V = vocab.length;
console.log(`Vocab: ${V} words`);

// ---------------- 3. PPMI co-occurrence ----------------
console.log("Building PPMI matrix…");
const cooc = new Map(); // i*V+j -> count (i<j)
const wc = new Float64Array(V);
let pairsTotal = 0;
for (const d of docs) {
  const idsIn = [...d.tokens].map((w) => widx.get(w)).filter((i) => i !== undefined).slice(0, 45);
  for (const i of idsIn) wc[i]++;
  for (let a = 0; a < idsIn.length; a++)
    for (let b = a + 1; b < idsIn.length; b++) {
      const i = Math.min(idsIn[a], idsIn[b]), j = Math.max(idsIn[a], idsIn[b]);
      const key = i * V + j;
      cooc.set(key, (cooc.get(key) ?? 0) + 1);
      pairsTotal++;
    }
}
// sparse PPMI rows
const rows = Array.from({ length: V }, () => []);
for (const [key, c] of cooc) {
  const i = Math.floor(key / V), j = key % V;
  const pmi = Math.log((c * docs.length) / (wc[i] * wc[j]));
  if (pmi > 0) {
    rows[i].push([j, pmi]);
    rows[j].push([i, pmi]);
  }
}

// ---------------- 4. SVD via randomized power iteration → 32-dim embeddings ----------------
console.log("Factorizing (power iteration, d=32)…");
const D = 32;
let B = Array.from({ length: V }, (_, i) => {
  // deterministic pseudo-random init
  const v = new Float64Array(D);
  let s = i * 2654435761 % 4294967296;
  for (let k = 0; k < D; k++) { s = (s * 1664525 + 1013904223) % 4294967296; v[k] = s / 4294967296 - 0.5; }
  return v;
});
const multiply = (X) => {
  const Y = Array.from({ length: V }, () => new Float64Array(D));
  for (let i = 0; i < V; i++) {
    const yi = Y[i];
    for (const [j, w] of rows[i]) {
      const xj = X[j];
      for (let k = 0; k < D; k++) yi[k] += w * xj[k];
    }
  }
  return Y;
};
const orthonormalize = (X) => {
  // Gram-Schmidt over columns
  for (let k = 0; k < D; k++) {
    for (let p = 0; p < k; p++) {
      let dot = 0;
      for (let i = 0; i < V; i++) dot += X[i][k] * X[i][p];
      for (let i = 0; i < V; i++) X[i][k] -= dot * X[i][p];
    }
    let norm = 0;
    for (let i = 0; i < V; i++) norm += X[i][k] * X[i][k];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < V; i++) X[i][k] /= norm;
  }
  return X;
};
for (let iter = 0; iter < 6; iter++) {
  B = orthonormalize(multiply(B));
  process.stdout.write(`\riter ${iter + 1}/6`);
}
console.log();
const emb = multiply(B); // final projection (unnormalized singular scaling — fine for cosine)
const norm = (v) => { let n = 0; for (const x of v) n += x * x; return Math.sqrt(n) || 1; };
const embN = emb.map((v) => { const n = norm(v); return Float32Array.from(v, (x) => x / n); });

// ---------------- 5. projections for runtime ----------------
console.log("Projecting genre affinities + neighbors…");
// genre affinity: P(genre|word) lift
const genreDocCount = {};
const wordGenre = new Map(); // i -> {genre: count}
for (const d of docs) {
  for (const g of d.genres) genreDocCount[g] = (genreDocCount[g] ?? 0) + 1;
  const idsIn = [...d.tokens].map((w) => widx.get(w)).filter((i) => i !== undefined);
  for (const i of idsIn) {
    const rec = wordGenre.get(i) ?? {};
    for (const g of d.genres) rec[g] = (rec[g] ?? 0) + 1;
    wordGenre.set(i, rec);
  }
}
const isTitleSuited = (w) => (titleWords.get(w) ?? 0) >= 3 && w.length >= 4 && w.length <= 12;
const genreWords = {};
for (const g of Object.keys(GENRES)) {
  const scored = [];
  for (let i = 0; i < V; i++) {
    const w = vocab[i];
    if (!isTitleSuited(w)) continue;
    const rec = wordGenre.get(i) ?? {};
    const inG = rec[g] ?? 0;
    if (inG < 3) continue;
    const lift = (inG / wc[i]) / ((genreDocCount[g] ?? 1) / docs.length);
    scored.push([w, Math.round(lift * Math.log(1 + inG) * 100) / 100]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  genreWords[g] = scored.slice(0, 170);
}
// neighbors via cosine (only for title-suited words, against title-suited words)
const suitedIdx = vocab.map((w, i) => i).filter((i) => isTitleSuited(vocab[i]));
const neighbors = {};
for (const i of suitedIdx) {
  const sims = [];
  for (const j of suitedIdx) {
    if (i === j) continue;
    let dot = 0;
    for (let k = 0; k < D; k++) dot += embN[i][k] * embN[j][k];
    sims.push([vocab[j], dot]);
  }
  sims.sort((a, b) => b[1] - a[1]);
  neighbors[vocab[i]] = sims.slice(0, 8).map(([w]) => w);
}
// keyword phrases + taglines per genre
const keywordPhrases = {};
const taglines = {};
for (const m of movies.values()) {
  const gs = m.genres.length ? m.genres : ["Drama"];
  for (const g of gs) {
    if (m.keywords) {
      keywordPhrases[g] ??= new Map();
      for (const k of m.keywords) {
        if (k.length > 4 && k.length < 32 && !/aftercreditsstinger|duringcreditsstinger|based on|woman director/.test(k))
          keywordPhrases[g].set(k, (keywordPhrases[g].get(k) ?? 0) + 1);
      }
    }
    if (m.tagline && m.tagline.length > 10 && m.tagline.length < 90) (taglines[g] ??= []).push(m.tagline);
  }
}
for (const g of Object.keys(keywordPhrases)) {
  keywordPhrases[g] = [...keywordPhrases[g].entries()].sort((a, b) => b[1] - a[1]).slice(0, 120).map(([k]) => k);
  taglines[g] = (taglines[g] ?? []).slice(0, 90);
}

const out = {
  _generated: new Date().toISOString(),
  _method: "TMDB corpus → doc co-occurrence → PPMI → 32-dim SVD (power iteration); cosine neighbors + genre lift",
  corpus: movies.size,
  genreWords,
  neighbors,
  keywordPhrases,
  taglines,
};
writeFileSync(join(root, "content", "lexicon.json"), JSON.stringify(out));
const kb = Math.round(JSON.stringify(out).length / 1024);
console.log(`Wrote content/lexicon.json (${kb} KB): ${Object.keys(neighbors).length} embedded words, ${Object.values(genreWords).reduce((s, a) => s + a.length, 0)} genre-ranked words`);
