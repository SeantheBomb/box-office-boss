// Preseeded start: the studio you inherit was RUN by somebody before you.
// We simulate a caretaker "predecessor" for N warmup days (rivals fully live), then
// hand over: inbox cleared, cash floored, welcome email summarizing the mid-flight slate.

import { Sim } from "./sim";
import { autoplay, disciplinedEmailPolicy, disciplinedMeetingPolicy } from "./autopilot";
import { mintPitch } from "./pitchgen";
import type { Content } from "./types";
import { calDate, SEASONS } from "./types";
import { money } from "./text";

export interface StartProfile {
  boss: string;
  studio: string;
  wallpaper?: string;
}

export function newSeededRun(content: Content, seed: number, profile?: StartProfile): Sim {
  // the player's identity shapes the world from day zero: studio name flows into
  // every news story, standings row, and rival needle
  const c: Content = profile ? { ...content, game: { ...content.game, studioName: profile.studio } } : content;
  const sim = Sim.newRun(c, seed);
  if (profile) sim.state.flags.profile = profile;
  const P = content.economy.preseed;
  // Two legacy productions your predecessor started: one lands ~2 weeks after handoff,
  // one is mid-shoot. The warmup autoplay carries them through the real pipeline.
  seedLegacyMovie(sim, "post", P.warmupDays - 8);
  seedLegacyMovie(sim, "production", Math.round(P.warmupDays * 0.75));
  // rivals were never cold: each starts with a released picture on the books and two in flight,
  // so the town has a release every week or two from day one
  for (let si = 1; si < sim.state.studios.length; si++) seedRivalLegacies(sim, si);
  autoplay(sim, {
    days: P.warmupDays,
    emailPolicy: disciplinedEmailPolicy(3),
    meetingPolicy: disciplinedMeetingPolicy(3),
  });
  const st = sim.state;
  // Undo a warmup game-over: the board "restructured" before you arrived.
  st.gameOver = undefined;
  sim.player.cash = Math.max(sim.player.cash, P.handoffCashFloor);
  st.patience = Math.max(st.patience, content.economy.startingPatience);
  // Hand over a clean desk: keep only emails that still need a decision.
  st.inbox = st.inbox.filter((e) => e.actions.length > 0 && !e.actionTaken);
  for (const e of st.inbox) e.read = false;
  welcomeEmail(sim);
  return sim;
}

/** Build a movie already mid-pipeline, with real talent locked and real events queued. */
function seedLegacyMovie(sim: Sim, phase: "post" | "production", milestoneDay: number) {
  const st = sim.state;
  const rng = sim.rng.get("world");
  const writer = rng.pick(st.people.filter((p) => p.role === "writer"));
  const pitch = mintPitch(rng, sim.content, st, writer, 0);
  const m = sim.createMovie(0, writer, pitch);
  const director = st.people.find((p) => p.role === "director" && p.busyUntil <= 0)!;
  const cast = st.people.filter((p) => p.role === "cast" && p.busyUntil <= 0).slice(0, 2);
  const producer = sim.staffProducers()[phase === "post" ? 0 : 1] ?? sim.staffProducers()[0];
  m.directorId = director.id;
  m.castIds = cast.map((c) => c.id);
  m.producerId = producer?.id;
  m.budget = Math.round(pitch.minBudget * 1.05);
  m.spent = Math.round(m.budget * (phase === "post" ? 0.7 : 0.35));
  m.dailyCost = Math.round((m.budget * sim.content.economy.production.baseDailyCostFactor) / 1000) * 1000;
  m.locations = director.avgLocations ?? 5;
  m.actualVfx = Math.round(m.estVfx * 1.05);
  const q = sim.rng.get("quality");
  m.quality.script = Math.max(5, Math.min(100, (writer.avgRating ?? 50) + q.gaussian(0, 8)));
  m.quality.direction = Math.max(5, Math.min(100, (director.avgRating ?? 50) + q.gaussian(0, 7)));
  m.quality.performance = Math.max(5, Math.min(100, (cast.reduce((s, c) => s + (c.avgRating ?? 50), 0) / Math.max(1, cast.length)) + q.gaussian(0, 6)));
  for (const p of [director, ...cast]) {
    p.busyUntil = milestoneDay + 40;
    p.signedByStudio = 0;
  }
  m.phaseStart = 0;
  m.phaseEnd = milestoneDay;
  if (phase === "post") {
    m.phase = "post";
    m.vfxStudioId = st.vfxStudios[0]?.id;
    sim.addEvent(milestoneDay, "afternoon", "outcome", "vfxDone", { movieId: m.id });
  } else {
    m.phase = "production";
    sim.addEvent(milestoneDay, "afternoon", "outcome", "productionWrap", { movieId: m.id });
  }
}

function seedRivalLegacies(sim: Sim, si: number) {
  const st = sim.state;
  const rng = sim.rng.get("world");
  const s = st.studios[si];
  const mk = () => {
    const writer = rng.pick(st.people.filter((p) => p.role === "writer"));
    const pitch = mintPitch(rng, sim.content, st, writer, si);
    const m = sim.createMovie(si, writer, pitch);
    m.budget = Math.round(pitch.minBudget * (0.9 + rng.next() * 0.3));
    const q = 40 + rng.int(0, 40);
    m.quality = { script: q, direction: q + rng.int(-8, 8), performance: q + rng.int(-8, 8), vfx: q, polish: q };
    m.actualVfx = m.estVfx;
    m.hype = 30 + rng.int(0, 35);
    const freeCast = st.people.filter((p) => p.role === "cast" && p.busyUntil <= 0);
    m.castIds = rng.shuffle([...freeCast]).slice(0, 2).map((c) => c.id);
    const freeDir = st.people.find((p) => p.role === "director" && p.busyUntil <= 0);
    if (freeDir) m.directorId = freeDir.id;
    return m;
  };
  // (a) one already on the books: released pre-history, revenue banked
  const hist = mk();
  hist.phase = "done";
  hist.releaseDay = 1;
  const r = hist.budget * (0.8 + rng.next() * 1.6);
  hist.revenue = r;
  hist.weeklyGross = [r * 0.4];
  s.totalRevenue += r;
  s.cash += r - hist.budget;
  s.totalSpent += hist.budget;
  s.reportedSpend += hist.budget + 3_000_000;
  // (b) one in post, release already dated inside the warmup window
  const post = mk();
  post.phase = "post";
  post.spent = post.budget * 0.7;
  s.totalSpent += post.spent;
  s.cash -= post.spent;
  post.dailyCost = 20000;
  const relDay = 5 + rng.int(0, 28);
  const relEv = sim.addEvent(relDay, "morning", "outcome", "release", { movieId: post.id, marketingTier: "standard" });
  post.announcedRelease = relEv.day;
  for (const cid of [...post.castIds, post.directorId].filter(Boolean) as string[]) {
    const p = sim.person(cid)!;
    p.busyUntil = relDay;
    p.signedByStudio = si;
  }
  // (c) one mid-production, wrapping soon after
  const prod = mk();
  prod.phase = "production";
  prod.spent = prod.budget * 0.3;
  s.totalSpent += prod.spent;
  s.cash -= prod.spent;
  prod.dailyCost = Math.round((prod.budget * sim.content.economy.production.baseDailyCostFactor) / 1000) * 1000;
  prod.phaseEnd = 15 + rng.int(0, 35);
  sim.addEvent(prod.phaseEnd, "afternoon", "outcome", "rivalWrap", { movieId: prod.id });
  for (const cid of [...prod.castIds, prod.directorId].filter(Boolean) as string[]) {
    const p = sim.person(cid)!;
    p.busyUntil = prod.phaseEnd + 60;
    p.signedByStudio = si;
  }
}

function welcomeEmail(sim: Sim) {
  const st = sim.state;
  const slate = st.movies.filter((m) => m.studio === 0 && !["done", "cancelled"].includes(m.phase));
  const producers = sim.staffProducers();
  const released = st.movies.filter((m) => m.studio === 0 && m.releaseDay !== undefined);
  const lines = slate.map((m) => {
    const rel = m.releaseDay ?? st.events.find((e) => e.type === "release" && e.data.movieId === m.id)?.day;
    const relStr = rel !== undefined ? (() => { const d = calDate(rel); return ` → releases WK ${d.week} ${SEASONS[d.season]}`; })() : "";
    const prod = sim.person(m.producerId);
    return `• ${m.title} (${m.genre}) — ${m.phase.toUpperCase()}${prod ? `, ${prod.name} producing` : ""}${relStr}`;
  });
  const ranked = [...st.studios].sort((a, b) => b.totalRevenue - b.reportedSpend - (a.totalRevenue - a.reportedSpend));
  const rank = ranked.indexOf(sim.player) + 1;
  const boss = st.flags.profile?.boss;
  sim.pushEmail({
    from: "The Board",
    fromRole: "board",
    subject: `Welcome to the big chair${boss ? `, ${boss}` : ""} (it's still warm)`,
    body:
      `${boss ? `${boss} — ` : ""}Your predecessor ran this studio for ${Math.round(st.day / 7)} weeks. They are pursuing exciting opportunities elsewhere. Do not pursue the same ones.\n\n` +
      `WHAT YOU'RE INHERITING:\n` +
      `${lines.length ? lines.join("\n") : "• An empty slate. Ominous, honestly."}\n\n` +
      `Producers on staff: ${producers.map((p) => p.name).join(", ") || "none"}.\n` +
      `Cash: ${money(sim.player.cash)}. Standings: #${rank} of ${st.studios.length}${released.length ? "" : " (nothing of ours released yet — the town is watching)"}.\n\n` +
      `Anything in your inbox still needs a decision — those are yours now. Quarterly reviews are real. So is the door.`,
    actions: [],
    ctx: {},
  });
}
