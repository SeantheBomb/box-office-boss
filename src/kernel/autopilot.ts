// Deterministic autopilot: drives a run with simple policies. Used by tests, the Sim Lab,
// and the preseed caretaker (the "predecessor" who ran the studio before the player).

import { Sim } from "./sim";
import { MeetingSession } from "./meetings";

/** The canonical sane-player policy: capped slate, affordable pitches, least-loaded producer,
 *  throughput-picked VFX, standard marketing/pricing. */
export function disciplinedEmailPolicy(maxActive = 3) {
  return (s: Sim, emailId: string, actions: { id: string; label: string }[]): string => {
    const active = s.state.movies.filter((m) => m.studio === 0 && !["done", "cancelled", "development"].includes(m.phase)).length;
    if (actions.some((a) => a.id === "scheduleMeeting")) {
      const em = s.state.inbox.find((e) => e.id === emailId);
      return active < maxActive && (em?.ctx.pitch?.minBudget ?? 0) < s.player.cash / 3 ? "scheduleMeeting" : "ignore";
    }
    const producerAssigns = actions.filter((a) => a.id.startsWith("assignProducer_"));
    if (producerAssigns.length) {
      const best = producerAssigns
        .map((a) => ({ a, load: s.producerLoad(a.id.slice("assignProducer_".length)) }))
        .sort((x, y) => x.load - y.load)[0];
      return best.load < s.content.economy.producers.idealLoad ? best.a.id : "park";
    }
    if (actions.some((a) => a.id === "hireProducer")) {
      const parked = s.state.movies.filter((m) => m.studio === 0 && m.phase === "development").length;
      return parked > 0 && s.player.cash > s.content.economy.producers.hireCost * 3 ? "hireProducer" : "ignore";
    }
    for (const p of ["approveProduction", "expandBudget", "divaIndulge", "triage_push"]) if (actions.some((a) => a.id === p)) return p;
    const vfxBids = actions.filter((a) => a.id.startsWith("vfx_"));
    if (vfxBids.length) {
      return vfxBids
        .map((a) => ({ a, v: s.state.vfxStudios.find((v) => v.id === a.id.slice(4))! }))
        .sort((x, y) => y.v.maxDailyShots - x.v.maxDailyShots)[0].a.id;
    }
    const mid = actions.find((a) => a.id.startsWith("mkt_standard") || a.id.startsWith("dist_standard"));
    return (mid ?? actions[0]).id;
  };
}

export function disciplinedMeetingPolicy(maxActive = 3) {
  return (s: Sim, choices: { id: string; line: string }[]): string => {
    const active = s.state.movies.filter((m) => m.studio === 0 && !["done", "cancelled", "development"].includes(m.phase)).length;
    if (active >= maxActive && choices.some((c) => c.id === "pos_pass")) return "pos_pass";
    const gl = choices.find((c) => c.id === "pos_greenlight");
    if (gl) return gl.id;
    // festival: keep the checkbook closed; packaging: first candidate is fine; packages: decline
    for (const id of ["pass", "ride", "pkg_decline"]) {
      const c = choices.find((x) => x.id === id);
      if (c) return c.id;
    }
    return choices[0].id;
  };
}

export interface AutopilotOptions {
  days: number;
  emailPolicy?: (sim: Sim, emailId: string, actions: { id: string; label: string }[]) => string;
  meetingPolicy?: (sim: Sim, choices: { id: string; line: string }[]) => string;
}

export function autoplay(sim: Sim, opts: AutopilotOptions) {
  const emailPolicy = opts.emailPolicy ?? ((_, __, actions) => actions[0].id);
  const meetingPolicy = opts.meetingPolicy ?? ((_, choices) => choices[0].id);
  for (let i = 0; i < opts.days && !sim.state.gameOver; i++) {
    const meetings = sim.advanceDay();
    for (const ev of meetings) {
      const session = new MeetingSession(sim, ev);
      let beat = session.start();
      let guard = 0;
      while (!beat.done && beat.choices?.length && guard++ < 10) {
        beat = session.choose(meetingPolicy(sim, beat.choices));
      }
    }
    // answer every actionable email same-day
    for (const em of [...sim.state.inbox]) {
      if (em.actions.length && !em.actionTaken) {
        sim.emailAction(em.id, emailPolicy(sim, em.id, em.actions));
      }
    }
  }
}

/** Stable-ish hash of run state for determinism tests. */
export function stateHash(sim: Sim): string {
  const s = sim.state;
  const key = JSON.stringify({
    day: s.day,
    cash: s.studios.map((x) => Math.round(x.cash)),
    movies: s.movies.map((m) => [m.id, m.phase, Math.round(m.revenue), Math.round(m.budget), m.castIds]),
    inbox: s.inbox.length,
    events: s.events.map((e) => [e.type, e.day]),
    patience: Math.round(s.patience),
  });
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
