// Deterministic session replay. Unlike PlayPen's fixed-step physics replay (which needs
// anchor/heartbeat resync because floats and timing can drift), BOB's kernel is a discrete,
// float-free turn machine: the recorded decision log (already captured automatically by
// sim.record() into state.decisions) IS the complete input. Replaying it against the same
// seed + content reproduces the run bit-for-bit — there's nothing to snap or resync, only
// a checkpoint hash to prove it. Zero DOM imports; safe for tests and the server alike.

import { Sim } from "./sim";
import { newSeededRun, type StartProfile } from "./preseed";
import { MeetingSession, type Beat } from "./meetings";
import { stateHash } from "./autopilot";
import type { Content, DecisionRecord, SimEvent } from "./types";

export interface SessionSnapshot {
  seed: number;
  profile?: StartProfile;
  /** The exact resolved Content the player had (bundled+published+draft, already merged) —
   *  captured once at session start, so a later content publish can't retroactively break
   *  a replay of an earlier session. */
  content: Content;
  decisions: DecisionRecord[];
  /** sim.state.day when recording stopped. The clock keeps ticking after a player's last
   *  click (quiet days, rivals moving, standings), so this can't be inferred from the last
   *  decision's day — without it, replay stops the instant the log runs dry and undercounts
   *  every trailing day, which showed up as a false "drift" (it wasn't; the days just never ran). */
  endDay: number;
}

export interface ReplayDesync {
  day: number;
  reason: string;
}

export interface ReplayOutcome {
  sim: Sim;
  /** Decisions actually applied. Less than total is normal for an abandoned/in-progress
   *  session (the recording just stops); it's only a problem alongside `desync`. */
  consumed: number;
  total: number;
  desync?: ReplayDesync;
}

export interface DecisionContext {
  day: number;
  kind: string;
  ref: string;
  choice: string;
  /** Human-readable one-liner for a transcript viewer — who was in the room / what the
   *  email said, and the line or action actually chosen. Best-effort: falls back to raw
   *  ids if the live text can't be recovered (e.g. an email long since trimmed from inbox). */
  label: string;
}

/** Advances one queued meeting to the next `choose()`-worthy beat, auto-draining any
 *  meetings that resolve with zero player choices (e.g. "nothing to review here"). */
function startNext(sim: Sim, queue: SimEvent[]): { session: MeetingSession; beat: Beat } | null {
  let ev = queue.shift();
  while (ev) {
    const session = new MeetingSession(sim, ev);
    const beat = session.start();
    if (!beat.done || !beat.choices?.length) return { session, beat };
    if (!queue.length) return null; // resolved itself, nothing left queued today
    ev = queue.shift();
  }
  return null;
}

/** Rebuild the exact run from a session snapshot and replay every recorded decision
 *  through the real kernel, day by day, in original order — meeting choices, email
 *  replies, and dossier-triggered actions (press tours, ...) all interleave correctly
 *  because they're replayed in the SAME sequence they were originally made in, not
 *  bucketed by kind. `onDay` fires once per simulated day for optional checkpoint hashing. */
export function replaySession(
  snapshot: SessionSnapshot,
  onDay?: (sim: Sim) => void,
  onDecision?: (ctx: DecisionContext) => void
): ReplayOutcome {
  const sim = newSeededRun(snapshot.content, snapshot.seed, snapshot.profile);
  const log = snapshot.decisions;
  let qi = 0;
  let current: { session: MeetingSession; beat: Beat } | null = null;

  // Keep ticking all the way to endDay even after the log runs dry — quiet days (rivals
  // moving, standings, nothing for the player to click) still happened and must replay too.
  while (sim.state.day < snapshot.endDay && !sim.state.gameOver) {
    const meetingsToday = sim.advanceDay();
    const localQueue = [...meetingsToday];
    if (!current) current = startNext(sim, localQueue);

    while (qi < log.length && log[qi].day === sim.state.day) {
      const dec = log[qi];
      if (dec.kind === "meeting") {
        if (!current) return { sim, consumed: qi, total: log.length, desync: { day: sim.state.day, reason: `expected an open meeting for choice "${dec.choice}" but none was queued` } };
        if (onDecision) {
          const title = sim.content.meetings[current.session.event.type]?.title ?? current.session.event.type;
          const line = current.beat.choices?.find((c) => c.id === dec.choice)?.line;
          onDecision({ day: dec.day, kind: dec.kind, ref: dec.ref, choice: dec.choice, label: `${title} — ${current.beat.speaker}: chose "${line ?? dec.choice}"` });
        }
        current.beat = current.session.choose(dec.choice);
        if (current.beat.done) current = startNext(sim, localQueue);
      } else if (dec.kind === "email") {
        if (onDecision) {
          const em = sim.state.inbox.find((e) => e.id === dec.ref);
          const actionLabel = em?.actions.find((a) => a.id === dec.choice)?.label;
          onDecision({ day: dec.day, kind: dec.kind, ref: dec.ref, choice: dec.choice, label: em ? `Email "${em.subject}" (${em.from}) → ${actionLabel ?? dec.choice}` : `Email ${dec.ref} → ${dec.choice}` });
        }
        sim.emailAction(dec.ref, dec.choice);
      } else if (dec.kind === "pressTour") {
        if (onDecision) {
          const m = sim.movie(dec.ref);
          onDecision({ day: dec.day, kind: dec.kind, ref: dec.ref, choice: dec.choice, label: `Press tour — ${m?.title ?? dec.ref}` });
        }
        sim.pressTour(dec.ref);
      }
      qi++;
    }
    onDay?.(sim);
  }
  return { sim, consumed: qi, total: log.length };
}

export interface DriftCheckpoint {
  day: number;
  hash: string;
}

/** Compares a replay's per-day hashes (from `onDay`) against checkpoints the live client
 *  recorded (via the same stateHash()) — the first mismatch is where content/code drifted
 *  from what the player actually experienced. Empty result = exact reproduction. */
export function checkDrift(snapshot: SessionSnapshot, recorded: DriftCheckpoint[]): { day: number; recordedHash: string; replayedHash: string }[] {
  const wanted = new Map(recorded.map((c) => [c.day, c.hash]));
  const mismatches: { day: number; recordedHash: string; replayedHash: string }[] = [];
  replaySession(snapshot, (sim) => {
    const want = wanted.get(sim.state.day);
    if (want !== undefined) {
      const got = stateHash(sim);
      if (got !== want) mismatches.push({ day: sim.state.day, recordedHash: want, replayedHash: got });
    }
  });
  return mismatches;
}
