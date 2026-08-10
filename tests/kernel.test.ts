import { describe, it, expect } from "vitest";
import { Sim } from "../src/kernel/sim";
import { bundledContent } from "../src/data/content";
import { autoplay, stateHash } from "../src/kernel/autopilot";
import { makeRng, RngBank } from "../src/kernel/rng";
import { mintWorld } from "../src/kernel/people";
import { computeFunnel } from "../src/kernel/audience";
import { calDate, DAYS_PER_YEAR } from "../src/kernel/types";
import { MeetingSession } from "../src/kernel/meetings";

const content = bundledContent();

describe("determinism", () => {
  it("same seed + same policy => identical state after 200 days", () => {
    const a = Sim.newRun(content, 12345);
    const b = Sim.newRun(content, 12345);
    autoplay(a, { days: 200 });
    autoplay(b, { days: 200 });
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it("different seeds diverge", () => {
    const a = Sim.newRun(content, 1);
    const b = Sim.newRun(content, 2);
    autoplay(a, { days: 120 });
    autoplay(b, { days: 120 });
    expect(stateHash(a)).not.toBe(stateHash(b));
  });

  it("named rng streams are independent", () => {
    const bank1 = new RngBank(99);
    const bank2 = new RngBank(99);
    bank1.get("a").next(); // extra draw on stream a
    bank1.get("a").next();
    expect(bank1.get("b").next()).toBe(bank2.get("b").next());
  });
});

describe("calendar", () => {
  it("divides the year into 4 seasons of 12 weeks", () => {
    expect(calDate(0)).toMatchObject({ year: 1, season: 0, week: 1, dayOfWeek: 0 });
    expect(calDate(DAYS_PER_YEAR - 1).year).toBe(1);
    expect(calDate(DAYS_PER_YEAR).year).toBe(2);
    expect(calDate(12 * 7).season).toBe(1);
  });
});

describe("people generation", () => {
  it("mints the configured counts with stats in archetype bounds", () => {
    const rng = makeRng(7);
    const { people, vfxStudios } = mintWorld(rng, content);
    const cast = people.filter((p) => p.role === "cast");
    expect(cast.length).toBe(content.people.counts.cast);
    expect(vfxStudios.length).toBe(content.people.counts.vfx);
    for (const c of cast) {
      expect(c.cooperation).toBeGreaterThanOrEqual(0);
      expect(c.cooperation).toBeLessThanOrEqual(100);
      expect(c.dailyRate).toBeGreaterThan(0);
      expect(c.name).toMatch(/\w+ \w+/);
    }
    for (const w of people.filter((p) => p.role === "writer")) {
      expect(w.capableGenres!.length).toBeGreaterThan(0);
    }
  });
});

describe("funnel", () => {
  it("stages are monotonic: reached >= interested >= tickets", () => {
    const sim = Sim.newRun(content, 42);
    autoplay(sim, { days: 60 });
    const m = sim.state.movies[0] ?? null;
    const probe = m ?? sim.createMovie(0, sim.state.people.find((p) => p.role === "writer")!, {
      title: "Test", genre: "Action", subgenre: "Heist", estRating: "PG-13", targetLength: 100,
      minBudget: 20000000, estVfx: 100, hook: "TEST", logline: "test", idealCastIds: [],
    } as any);
    probe.hype = 50;
    probe.fanScore = 60;
    const f = computeFunnel(content, sim.state, probe, 0.55);
    expect(f.reached).toBeGreaterThanOrEqual(f.interested);
    expect(f.interested).toBeGreaterThanOrEqual(f.tickets);
    expect(f.gross).toBeGreaterThan(0);
  });
});

describe("full loop", () => {
  it("a disciplined player releases movies within 2 years", () => {
    const sim = Sim.newRun(content, 777);
    autoplay(sim, {
      days: DAYS_PER_YEAR * 2,
      // cap the slate at 3 active projects; greenlight, expand budgets, standard everything
      emailPolicy: (s, emailId, actions) => {
        const active = s.state.movies.filter((m) => m.studio === 0 && !["done", "cancelled"].includes(m.phase)).length;
        if (actions.some((a) => a.id === "scheduleMeeting")) {
          const em = s.state.inbox.find((e) => e.id === emailId);
          const affordable = (em?.ctx.pitch?.minBudget ?? 0) < s.player.cash / 3;
          return active < 3 && affordable ? "scheduleMeeting" : "ignore";
        }
        const prefer = ["approvePrepro", "approveProduction", "expandBudget"];
        for (const p of prefer) if (actions.some((a) => a.id === p)) return p;
        const vfxBids = actions.filter((a) => a.id.startsWith("vfx_"));
        if (vfxBids.length) {
          // hire for throughput, like a person who reads the bids would
          const best = vfxBids
            .map((a) => ({ a, v: s.state.vfxStudios.find((v) => v.id === a.id.slice(4))! }))
            .sort((x, y) => y.v.maxDailyShots - x.v.maxDailyShots)[0];
          return best.a.id;
        }
        const mid = actions.find((a) => a.id.startsWith("mkt_standard") || a.id.startsWith("dist_standard"));
        return (mid ?? actions[0]).id;
      },
      meetingPolicy: (s, choices) => {
        const active = s.state.movies.filter((m) => m.studio === 0 && !["done", "cancelled"].includes(m.phase)).length;
        if (active >= 3 && choices.some((c) => c.id === "pos_pass")) return "pos_pass";
        const gl = choices.find((c) => c.id === "pos_greenlight");
        return (gl ?? choices[0]).id;
      },
    });
    const released = sim.state.movies.filter((m) => m.studio === 0 && m.releaseDay !== undefined);
    expect(released.length).toBeGreaterThan(0);
    expect(released[0].reviews.length).toBeGreaterThan(0);
    expect(released[0].revenue).toBeGreaterThan(0);
  });

  it("rivals release movies and standings track all studios", () => {
    const sim = Sim.newRun(content, 555);
    // passive player: ignore everything; the world should keep moving without you
    autoplay(sim, {
      days: DAYS_PER_YEAR,
      emailPolicy: (_, __, actions) => (actions.find((a) => a.id === "ignore") ?? actions[actions.length - 1]).id,
    });
    const rivalReleases = sim.state.movies.filter((m) => m.studio !== 0 && m.releaseDay !== undefined);
    expect(rivalReleases.length).toBeGreaterThan(0);
    for (const s of sim.state.studios) expect(s.history.length).toBeGreaterThan(30);
  });

  it("an idle player eventually gets fired or goes bankrupt", () => {
    const sim = Sim.newRun(content, 31337);
    // never answer anything: patience + overhead should end the run inside 6 years
    for (let i = 0; i < DAYS_PER_YEAR * 6 && !sim.state.gameOver; i++) {
      const meetings = sim.advanceDay();
      for (const ev of meetings) {
        const session = new MeetingSession(sim, ev);
        let beat = session.start();
        let guard = 0;
        while (!beat.done && beat.choices?.length && guard++ < 10) beat = session.choose(beat.choices[0].id);
      }
    }
    expect(sim.state.gameOver).toBeTruthy();
  });
});

describe("email composer", () => {
  it("no unresolved slots or missing banks leak into player emails", () => {
    const sim = Sim.newRun(content, 2024);
    autoplay(sim, { days: 200 });
    for (const em of sim.state.inbox) {
      expect(em.body).not.toMatch(/\[missing bank:/);
      expect(em.subject).not.toMatch(/\[missing bank:/);
    }
  });
});
