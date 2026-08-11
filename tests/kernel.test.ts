import { describe, it, expect } from "vitest";
import { Sim } from "../src/kernel/sim";
import { bundledContent } from "../src/data/content";
import { autoplay, stateHash, disciplinedEmailPolicy, disciplinedMeetingPolicy } from "../src/kernel/autopilot";
import { newSeededRun } from "../src/kernel/preseed";
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
    autoplay(sim, { days: DAYS_PER_YEAR * 2, emailPolicy: disciplinedEmailPolicy(3), meetingPolicy: disciplinedMeetingPolicy(3) });
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
    // founding studios track from week 1; replacement entrants may have shorter histories
    for (const s of sim.state.studios.slice(0, 6)) expect(s.history.length).toBeGreaterThan(30);
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
        while (!beat.done && beat.choices?.length && guard++ < 18) beat = session.choose(beat.choices.find((c) => !c.gated)?.id ?? beat.choices[0].id);
      }
    }
    expect(sim.state.gameOver).toBeTruthy();
  });
});

describe("phase 2 systems", () => {
  const run = (seed: number, days: number) => {
    const sim = Sim.newRun(content, seed);
    autoplay(sim, { days, emailPolicy: disciplinedEmailPolicy(4), meetingPolicy: disciplinedMeetingPolicy(4) });
    return sim;
  };

  it("no two non-franchise movies share a title", () => {
    const sim = run(1234, DAYS_PER_YEAR * 2);
    const nonFranchise = sim.state.movies.filter((m) => !m.franchise && !m.sequelOf);
    const titles = nonFranchise.map((m) => m.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("movies never enter prepro without a producer; production never starts uncast", () => {
    const sim = run(555, DAYS_PER_YEAR);
    for (const m of sim.state.movies.filter((m) => m.studio === 0)) {
      if (["prepro", "production", "post", "release", "distribute", "done"].includes(m.phase)) {
        expect(m.producerId, `${m.title} in ${m.phase} without producer`).toBeTruthy();
      }
      if (["production", "post", "release", "distribute", "done"].includes(m.phase)) {
        expect(m.castIds.length, `${m.title} in ${m.phase} uncast`).toBeGreaterThan(0);
      }
    }
  });

  it("meetings land on weekdays only", () => {
    const sim = run(31, DAYS_PER_YEAR);
    // scan the decision-era event log via pending + a fresh sweep
    for (const e of sim.state.events.filter((e) => e.kind === "meeting")) {
      expect(calDate(e.day).dayOfWeek, `meeting ${e.type} on weekend day ${e.day}`).toBeLessThan(5);
    }
  });

  it("standings report zero spend until a movie releases", () => {
    const sim = Sim.newRun(content, 99);
    autoplay(sim, { days: 60, emailPolicy: disciplinedEmailPolicy(3), meetingPolicy: disciplinedMeetingPolicy(3) });
    const released = sim.state.movies.filter((m) => m.studio === 0 && m.releaseDay !== undefined);
    if (released.length === 0) {
      expect(sim.player.reportedSpend).toBe(0);
      expect(sim.player.totalSpent).toBeGreaterThan(0); // real books tell the truth
    }
  });

  it("rivals go bankrupt instead of running on negative cash forever", () => {
    const sim = run(555, DAYS_PER_YEAR * 3);
    for (const s of sim.state.studios.filter((s) => !s.isPlayer && !s.bankrupt)) {
      expect(s.cash).toBeGreaterThan(-30_000_000 * 4); // grace window bounded, no −75M zombies
    }
  });

  it("preseeded run hands over a mid-flight studio", () => {
    const sim = newSeededRun(content, 2027);
    expect(sim.state.gameOver).toBeUndefined();
    expect(sim.player.cash).toBeGreaterThanOrEqual(content.economy.preseed.handoffCashFloor);
    const slate = sim.state.movies.filter((m) => m.studio === 0 && !["done", "cancelled"].includes(m.phase));
    expect(slate.length).toBeGreaterThan(0);
    // something releases within ~4 weeks of handoff
    const upcoming = sim.state.movies.some(
      (m) => m.studio === 0 && ((m.releaseDay !== undefined && m.phase === "release") || sim.state.events.some((e) => e.type === "release" && e.data.movieId === m.id && e.day < sim.state.day + 28))
    );
    expect(upcoming).toBe(true);
    // welcome email present, history backdated
    expect(sim.state.inbox.some((e) => e.subject.includes("Welcome"))).toBe(true);
    expect(sim.player.history.length).toBeGreaterThan(4);
    // deterministic
    const again = newSeededRun(content, 2027);
    expect(stateHash(again)).toBe(stateHash(sim));
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
