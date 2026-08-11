// Dev-time TMDB bake: real movie titles/loglines/economics + real name pools recombined
// into fictional people. Output: content/inspiration.json (static, deterministic at runtime).
// Token is read from Fantasy Box Office's .dev.vars — never committed here.
// Usage: node tools/bake-tmdb.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVars = readFileSync("C:/Users/SeanF/Documents/FantasyBoxOffice/.dev.vars", "utf8");
const TOKEN = devVars.match(/TMDB_TOKEN=(\S+)/)?.[1];
if (!TOKEN) throw new Error("TMDB_TOKEN not found in FBO .dev.vars");
// the stored v4 bearer is truncated; its JWT payload carries the v3 api key in `aud`
const API_KEY = Buffer.from(TOKEN.split(".")[1], "base64").toString().match(/"aud":"([a-f0-9]+)"/)[1];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, params = {}, attempt = 0) => {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", API_KEY);
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(1500);
      return api(path, params, attempt);
    }
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt < 3) {
      await sleep(1000 * (attempt + 1));
      return api(path, params, attempt + 1);
    }
    throw e;
  }
};

const GENRE_MAP = {
  28: "Action", 35: "Comedy", 27: "Horror", 18: "Drama", 878: "Sci-Fi",
  53: "Thriller", 10751: "Family", 37: "Western", 12: "Action", 80: "Thriller",
  9648: "Thriller", 14: "Family", 16: "Family", 10749: "Comedy", 36: "Drama", 10752: "Drama",
};

console.log("Fetching movie lists…");
const movies = [];
for (let page = 1; page <= 25; page++) {
  movies.push(...(await api("/movie/popular", { page })).results);
  movies.push(...(await api("/movie/top_rated", { page })).results);
  await sleep(60);
}
const seen = new Set();
const unique = movies.filter((m) => {
  if (seen.has(m.id) || !m.title || /[^\x00-\x7F]/.test(m.title)) return false;
  seen.add(m.id);
  return true;
});
console.log(`${unique.length} unique English-title movies`);

console.log("Fetching details for economics (250 sampled)…");
const detailed = [];
const sample = unique.filter((m) => m.vote_count > 500).slice(0, 250);
for (const m of sample) {
  const d = await api(`/movie/${m.id}`).catch(() => null);
  if (d) detailed.push(d);
  if (detailed.length % 25 === 0) process.stdout.write(`\r${detailed.length}/${sample.length}`);
  await sleep(30);
}
console.log();

console.log("Fetching popular people names…");
const first = new Set();
const last = new Set();
for (let page = 1; page <= 40; page++) {
  const res = await api("/person/popular", { page });
  await sleep(60);
  for (const p of res.results) {
    if (!p.name || /[^\x00-\x7F]/.test(p.name)) continue;
    const parts = p.name.split(/\s+/);
    if (parts.length >= 2) {
      first.add(parts[0]);
      last.add(parts[parts.length - 1]);
    }
  }
}
console.log(`${first.size} first names, ${last.size} last names`);

// title word harvest: adjectives/nouns from real titles feed the grammar banks
const stop = new Set(["the", "a", "an", "of", "and", "in", "on", "to", "for", "with", "at", "part", "vs", "is", "it", "no", "my", "i", "ii", "iii"]);
const titleWords = new Set();
for (const m of unique) {
  for (const w of m.title.replace(/[^a-zA-Z\s]/g, "").split(/\s+/)) {
    if (w.length > 3 && !stop.has(w.toLowerCase())) titleWords.add(w[0].toUpperCase() + w.slice(1).toLowerCase());
  }
}

// loglines: first sentence of overviews, trimmed
const loglines = unique
  .map((m) => (m.overview ?? "").split(/(?<=[.!?])\s/)[0])
  .filter((s) => s.length > 30 && s.length < 140 && !/[^\x00-\x7F]/.test(s));

// genre economics from detailed sample
const econ = {};
for (const m of detailed) {
  if (!m.budget || !m.revenue || m.budget < 1e6) continue;
  const g = GENRE_MAP[m.genres?.[0]?.id];
  if (!g) continue;
  (econ[g] ??= []).push({ budget: m.budget, revenue: m.revenue });
}
const median = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const genreEconomics = {};
for (const [g, rows] of Object.entries(econ)) {
  genreEconomics[g] = {
    n: rows.length,
    budgetMedian: median(rows.map((r) => r.budget)),
    revenueMedian: median(rows.map((r) => r.revenue)),
    mult: Math.round((median(rows.map((r) => r.revenue / r.budget)) + Number.EPSILON) * 100) / 100,
  };
}

const out = {
  _generated: new Date().toISOString(),
  _source: "TMDB (dev-time bake; no runtime API use)",
  titles: unique.map((m) => m.title).slice(0, 800),
  titleWords: [...titleWords].slice(0, 900),
  loglineSeeds: loglines.slice(0, 400),
  namePools: { first: [...first].slice(0, 700), last: [...last].slice(0, 700) },
  genreEconomics,
};
writeFileSync(join(root, "content", "inspiration.json"), JSON.stringify(out, null, 2));
console.log(`Wrote content/inspiration.json: ${out.titles.length} titles, ${out.titleWords.length} words, ${out.loglineSeeds.length} loglines, ${out.namePools.first.length}+${out.namePools.last.length} names, econ for ${Object.keys(genreEconomics).join(", ")}`);
