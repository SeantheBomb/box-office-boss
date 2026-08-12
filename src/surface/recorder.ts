// Session recorder: captures a real (non-bot) playsession precisely enough to reproduce
// it — the resolved content bundle as played, the run's seed/profile, and the player's
// decision log (state.decisions, which the kernel already keeps automatically). Nothing
// here samples or approximates; replay.ts re-runs the actual simulation from this input.
//
// Bot detection: the window.BOB debug console (skipDays et al — the same entry point every
// scripted playtest in this repo has used) taints the session. Tainted sessions are dropped,
// not uploaded, unless uploadTainted is set (pipeline testing) — they'd still arrive flagged.
//
// Upload is chunked (periodic + on end + best-effort on pagehide/hidden) so a tab-closed-
// mid-run session still lands, minus at most the last partial chunk. Fire-and-forget:
// recording must never break play.

import type { Sim } from "../kernel/sim";
import { stateHash } from "../kernel/autopilot";
import type { StartProfile } from "../kernel/preseed";

const FLUSH_MS = 45_000;
const FLUSH_DECISIONS = 60;

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pid(): string {
  try {
    let v = localStorage.getItem("bob.pid");
    if (!v) {
      v = newId();
      localStorage.setItem("bob.pid", v);
    }
    return v;
  } catch {
    return "anon";
  }
}

export interface SessionMeta {
  id: string;
  pid: string;
  startedAt: string; // wall-clock ISO — when the human actually played
  seed: number;
  profile?: StartProfile;
  endDay: number; // sim.state.day as of the last sync — replay's stopping point
  decisions: number; // count uploaded so far, informational
  released: number;
  gameOverKind: string; // "" | "bankrupt" | "fired"
  endReason: string; // "(open)" | "gameover-bankrupt" | "gameover-fired" | "reset" | "abandoned"
  tainted: boolean;
  taintReason?: string;
  dev: boolean; // editor was opened this session
  ua: string;
  viewport: { w: number; h: number };
}

class Recorder {
  /** Testing hook: upload tainted (bot/scripted) sessions instead of dropping them. */
  uploadTainted = false;

  private sim: Sim | null = null;
  private meta: SessionMeta | null = null;
  private watermark = 0; // sim.state.decisions.length at last flush — excludes the caretaker's warmup
  private checkpoints: { day: number; hash: string }[] = [];
  private seq = 0;
  private sentContent = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    try {
      window.addEventListener("pagehide", () => this.end("abandoned", true));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && this.meta) this.flush(false, true);
      });
    } catch {
      /* recorder must never break boot */
    }
  }

  get active(): boolean {
    return this.meta !== null;
  }
  get sessionId(): string | null {
    return this.meta?.id ?? null;
  }

  begin(sim: Sim): void {
    try {
      if (this.meta) this.end("restarted");
      this.sim = sim;
      this.watermark = sim.state.decisions.length;
      this.seq = 0;
      this.sentContent = false;
      this.checkpoints = [];
      this.meta = {
        id: newId(),
        pid: pid(),
        startedAt: new Date().toISOString(),
        seed: sim.state.seed,
        profile: sim.state.flags.profile,
        endDay: sim.state.day,
        decisions: 0,
        released: 0,
        gameOverKind: "",
        endReason: "(open)",
        tainted: false,
        dev: location.hostname === "localhost",
        ua: navigator.userAgent.slice(0, 160),
        viewport: { w: Math.round(window.innerWidth), h: Math.round(window.innerHeight) },
      };
      this.checkpoints.push({ day: sim.state.day, hash: stateHash(sim) });
      this.timer = setInterval(() => this.flush(false), FLUSH_MS);
    } catch {
      /* never break play */
    }
  }

  taint(reason: string): void {
    if (this.meta && !this.meta.tainted) {
      this.meta.tainted = true;
      this.meta.taintReason = reason;
    }
  }

  markDevOpened(): void {
    if (this.meta) this.meta.dev = true;
  }

  /** Call after anything that might have advanced the sim (the app's bump()). Cheap no-op
   *  when nothing changed; takes a checkpoint hash and flushes once enough new decisions
   *  have piled up, or ends the session outright on game-over. */
  sync(): void {
    if (!this.meta || !this.sim) return;
    const st = this.sim.state;
    if (st.decisions.length - this.watermark > 0 || st.day !== this.meta.endDay) {
      this.meta.endDay = st.day;
      this.meta.released = st.movies.filter((m) => m.studio === 0 && m.releaseDay !== undefined).length;
      this.checkpoints.push({ day: st.day, hash: stateHash(this.sim) });
    }
    if (st.gameOver) {
      this.meta.gameOverKind = st.gameOver.kind;
      this.end(st.gameOver.kind === "bankrupt" ? "gameover-bankrupt" : "gameover-fired");
      return;
    }
    if (st.decisions.length - this.watermark >= FLUSH_DECISIONS) this.flush(false);
  }

  /** Studio reset (new game) or a stale-save wipe — end whatever was recording. */
  end(reason: string, useBeacon = false): void {
    if (!this.meta || !this.sim) return;
    const st = this.sim.state;
    this.meta.endDay = st.day;
    this.meta.endReason = reason;
    this.meta.released = st.movies.filter((m) => m.studio === 0 && m.releaseDay !== undefined).length;
    if (st.gameOver) this.meta.gameOverKind = st.gameOver.kind;
    this.checkpoints.push({ day: st.day, hash: stateHash(this.sim) });
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush(true, useBeacon);
    this.meta = null;
    this.sim = null;
  }

  private flush(final: boolean, useBeacon = false): void {
    const meta = this.meta;
    const sim = this.sim;
    if (!meta || !sim) return;
    if (meta.tainted && !this.uploadTainted) return; // bot-driven sessions aren't captured — the point of the taint flag
    const st = sim.state;
    const decisions = st.decisions.slice(this.watermark);
    if (!final && decisions.length === 0) return;
    this.watermark = st.decisions.length;
    meta.decisions += decisions.length;
    try {
      const body: Record<string, unknown> = { id: meta.id, seq: this.seq++, meta, decisions, checkpoints: this.checkpoints };
      this.checkpoints = [];
      if (!this.sentContent) {
        body.content = sim.content;
        this.sentContent = true;
      }
      const payload = JSON.stringify(body);
      const url = "/api/sessions";
      if (useBeacon && navigator.sendBeacon && payload.length < 60_000) {
        navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      } else {
        void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: useBeacon }).catch(() => {});
      }
    } catch {
      /* never break play */
    }
  }
}

export const recorder = new Recorder();
