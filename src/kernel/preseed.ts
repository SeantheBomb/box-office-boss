// Preseeded start: the studio you inherit was RUN by somebody before you.
// We simulate a caretaker "predecessor" for N warmup days (rivals fully live), then
// hand over: inbox cleared, cash floored, welcome email summarizing the mid-flight slate.

import { Sim } from "./sim";
import { autoplay, disciplinedEmailPolicy, disciplinedMeetingPolicy } from "./autopilot";
import { mintPitch } from "./pitchgen";
import type { Content } from "./types";
import { calDate, SEASONS } from "./types";
import { money } from "./text";

export function newSeededRun(content: Content, seed: number): Sim {
  const sim = Sim.newRun(content, seed);
  const P = content.economy.preseed;
  // Two legacy productions your predecessor started: one lands ~2 weeks after handoff,
  // one is mid-shoot. The warmup autoplay carries them through the real pipeline.
  seedLegacyMovie(sim, "post", P.warmupDays - 8);
  seedLegacyMovie(sim, "production", Math.round(P.warmupDays * 0.75));
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
  sim.pushEmail({
    from: "The Board",
    fromRole: "board",
    subject: "Welcome to the big chair (it's still warm)",
    body:
      `Your predecessor ran this studio for ${Math.round(st.day / 7)} weeks. They are pursuing exciting opportunities elsewhere. Do not pursue the same ones.\n\n` +
      `WHAT YOU'RE INHERITING:\n` +
      `${lines.length ? lines.join("\n") : "• An empty slate. Ominous, honestly."}\n\n` +
      `Producers on staff: ${producers.map((p) => p.name).join(", ") || "none"}.\n` +
      `Cash: ${money(sim.player.cash)}. Standings: #${rank} of ${st.studios.length}${released.length ? "" : " (nothing of ours released yet — the town is watching)"}.\n\n` +
      `Anything in your inbox still needs a decision — those are yours now. Quarterly reviews are real. So is the door.`,
    actions: [],
    ctx: {},
  });
}
