// Deterministic autopilot: drives a run with simple policies. Used by tests and the Sim Lab.

import { Sim } from "./sim";
import { MeetingSession } from "./meetings";

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
