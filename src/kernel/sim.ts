// The simulation kernel. Headless, deterministic, content-driven.
// Player interacts via emailAction() and meeting choice resolution; everything else
// flows through the day tick and the event queue.

import { RngBank } from "./rng";
import type { Rng } from "./rng";
import {
  type Content,
  type Email,
  type Intel,
  type Mandate,
  type Movie,
  type Promise2,
  type Reputation,
  type Person,
  type RunState,
  type SimEvent,
  type Slot,
  type Studio,
  calDate,
  DAYS_PER_WEEK,
  SEASONS,
  WEEKS_PER_SEASON,
} from "./types";
import { mintWorld } from "./people";
import { mintPitch, mintSequelPitch, type PitchData } from "./pitchgen";
import { computeFunnel, discover, initAudience, weeklyFadTick, type FunnelResult } from "./audience";
import { bankLine, fill, money, count, selectLine } from "./text";
import { mintVoice, voiceWrap, callbackLine, remember } from "./voice";

export class Sim {
  state: RunState;
  content: Content;
  rng: RngBank;
  /** meetings waiting for the player, in slot order for today */
  pendingMeetings: SimEvent[] = [];

  constructor(content: Content, state: RunState, rngStates?: Record<string, number>) {
    this.content = content;
    this.state = state;
    this.rng = new RngBank(state.seed, rngStates);
    // P5 fields default in-place so pre-P5 v3 saves keep working
    state.intel ??= [];
    state.promises ??= [];
    state.reputation ??= { paysWell: 50, onTime: 50, prestige: 50, loyalty: 50 };
  }

  // ---------- P5: reputation, intel, promises, institutions ----------
  rep(axis: keyof Reputation, delta: number) {
    const r = this.state.reputation!;
    r[axis] = Math.max(0, Math.min(100, r[axis] + delta));
  }

  /** The town's read on you, in the town's words. */
  repLine(): string {
    const r = this.state.reputation!;
    const bits: string[] = [];
    if (r.paysWell > 65) bits.push("pays full freight");
    else if (r.paysWell < 35) bits.push("squeezes every nickel");
    if (r.onTime > 65) bits.push("ships on the date");
    else if (r.onTime < 35) bits.push("slips every date");
    if (r.prestige > 65) bits.push("makes real pictures");
    else if (r.prestige < 35) bits.push("makes product");
    if (r.loyalty > 65) bits.push("stands by their people");
    else if (r.loyalty < 35) bits.push("burns bridges for warmth");
    return bits.length ? bits.join(", ") : "still an unknown quantity";
  }

  addIntel(kind: Intel["kind"], subjectId: string | undefined, text: string, reliable = true) {
    const intel: Intel = { id: this.id("in"), kind, subjectId, text, day: this.state.day, reliable };
    this.state.intel!.push(intel);
    if (this.state.intel!.length > 12) this.state.intel!.shift();
    return intel;
  }

  freshIntel(subjectId?: string): Intel[] {
    return this.state.intel!.filter((i) => !i.used && this.state.day - i.day < 120 && (!subjectId || i.subjectId === subjectId));
  }

  addPromise(kind: Promise2["kind"], text: string, personId?: string, movieId?: string): Promise2 {
    const p: Promise2 = { id: this.id("pr"), kind, personId, movieId, text, day: this.state.day };
    this.state.promises!.push(p);
    return p;
  }

  honorPromise(p: Promise2, note?: string) {
    p.honored = true;
    this.rep("loyalty", 3);
    const person = this.person(p.personId);
    if (person) {
      person.relationship += 10;
      remember(person, this.state.day, `you kept your word on ${note ?? p.text}`, 10);
    }
  }

  breakPromise(p: Promise2, note?: string) {
    p.broken = true;
    this.rep("loyalty", -6);
    const person = this.person(p.personId);
    if (person) {
      person.relationship -= 14;
      remember(person, this.state.day, `you broke your promise: ${note ?? p.text}`, -14);
    }
  }

  columnists(): { news: string; gossip: string } {
    if (!this.state.flags.columnists) {
      const rng = this.rng.get("world");
      const banks = this.content.people.nameBanks;
      const mk = () => `${rng.pick([...banks.firstM, ...banks.firstF] as string[])} ${rng.pick(banks.last as string[])}`;
      this.state.flags.columnists = { news: mk(), gossip: mk() };
    }
    return this.state.flags.columnists;
  }

  static newRun(content: Content, seed: number): Sim {
    const state: RunState = {
      seed,
      day: 0,
      timeOfDay: 0,
      studios: [],
      people: [],
      vfxStudios: [],
      movies: [],
      audience: { segments: [], fads: {} },
      events: [],
      inbox: [],
      patience: content.economy.startingPatience,
      patienceTier: 0,
      decisions: [],
      nextId: 1,
      flags: {},
      eventLog: [],
      mandates: [],
      weekChart: [],
    };
    const sim = new Sim(content, state);
    const world = sim.rng.get("world");
    const minted = mintWorld(world, content);
    state.people = minted.people;
    state.vfxStudios = minted.vfxStudios;
    state.audience = initAudience(sim.rng.get("audience"), content);
    const mkStudio = (name: string, isPlayer: boolean): Studio => ({
      name,
      cash: isPlayer ? content.economy.startingCash : content.economy.rivals.startingCash,
      isPlayer,
      history: [],
      totalRevenue: 0,
      totalSpent: 0,
      reportedSpend: 0,
    });
    state.studios.push(mkStudio(content.game.studioName, true));
    for (const rn of content.people.nameBanks.rivalStudios as string[]) {
      const s = mkStudio(rn, false);
      s.riskAppetite = 0.3 + world.next() * 0.6;
      s.persona = world.pick(["aggressive", "prestige", "cheap", "franchise", "chaotic"]);
      state.studios.push(s);
    }
    // your starting producer staff
    const producers = state.people.filter((p) => p.role === "producer");
    for (const p of producers.slice(0, content.economy.producers.startingRoster)) p.signedByStudio = 0;
    // seed the writer pitch flywheel
    for (const w of state.people.filter((p) => p.role === "writer")) {
      sim.scheduleWriterPitch(w, world.int(2, 30));
    }
    sim.addEvent(sim.weekday(world.int(20, 40)), "morning", "outcome", "producerOffer", {});
    return sim;
  }

  /** Next weekday (MON-FRI) at or after `day`. Meetings and player-facing mail land on weekdays only. */
  weekday(day: number): number {
    while (calDate(day).dayOfWeek >= 5) day++;
    return day;
  }

  bookMeeting(earliestDay: number, slot: Slot, type: string, data: Record<string, any> = {}): SimEvent {
    return this.addEvent(this.weekday(Math.max(earliestDay, this.state.day + 1)), slot, "meeting", type, data);
  }

  producerLoad(pid: string): number {
    return this.state.movies.filter((m) => m.producerId === pid && ["prepro", "production", "post"].includes(m.phase)).length;
  }

  /** 1.0 at or under ideal load; grows per extra project. Applied to timelines, burn, and polish. */
  overloadFactor(pid?: string): number {
    if (!pid) return 1;
    const P = this.content.economy.producers;
    return 1 + Math.max(0, this.producerLoad(pid) - P.idealLoad) * P.overloadPenaltyPerExtra;
  }

  staffProducers(): Person[] {
    return this.state.people.filter((p) => p.role === "producer" && p.signedByStudio === 0);
  }

  estimateRevenue(minBudget: number, genre: string): number {
    const mult = this.content.economy.revenueEstimate.genreMultiplier[genre] ?? 2.4;
    const fad = this.state.audience.fads[genre] ?? 1;
    return Math.round((minBudget * mult * (0.7 + fad * 0.3)) / 1e5) * 1e5;
  }

  // ---------- ids / events / email ----------
  id(prefix: string): string {
    return `${prefix}${this.state.nextId++}`;
  }

  addEvent(day: number, slot: Slot, kind: "meeting" | "outcome", type: string, data: Record<string, any> = {}): SimEvent {
    const ev: SimEvent = { id: this.id("ev"), day, slot, kind, type, data };
    this.state.events.push(ev);
    this.state.events.sort((a, b) => a.day - b.day);
    return ev;
  }

  pushEmail(e: Omit<Email, "id" | "day" | "read">): Email {
    const email: Email = { ...e, id: this.id("em"), day: this.state.day, read: false };
    this.state.inbox.unshift(email);
    const max = this.content.game.maxInbox;
    if (this.state.inbox.length > max) {
      // never trim emails with pending actions
      for (let i = this.state.inbox.length - 1; i >= 0 && this.state.inbox.length > max; i--) {
        const em = this.state.inbox[i];
        if (!em.actions.length || em.actionTaken) this.state.inbox.splice(i, 1);
      }
    }
    return email;
  }

  record(kind: string, ref: string, choice: string) {
    this.state.decisions.push({ day: this.state.day, kind, ref, choice });
  }

  person(id?: string): Person | undefined {
    return id ? this.state.people.find((p) => p.id === id) : undefined;
  }
  movie(id?: string): Movie | undefined {
    return id ? this.state.movies.find((m) => m.id === id) : undefined;
  }
  get player(): Studio {
    return this.state.studios[0];
  }

  spend(studio: number, amount: number) {
    const s = this.state.studios[studio];
    s.cash -= amount;
    s.totalSpent += amount;
  }
  earn(studio: number, amount: number) {
    const s = this.state.studios[studio];
    s.cash += amount;
    s.totalRevenue += amount;
  }

  bossName(): string {
    return this.state.flags.profile?.boss ?? "Boss";
  }

  toneTier(): number {
    const tiers = this.content.economy.patienceTiers as number[];
    let tier = 0;
    for (const t of tiers) if (this.state.patience < t) tier++;
    return tier;
  }

  // ---------- day tick ----------
  /** Advance one full day. Returns meetings that need the player (pause + scene). */
  advanceDay(): SimEvent[] {
    if (this.state.gameOver) return [];
    const st = this.state;
    st.day++;
    st.timeOfDay = 0;
    const today = st.events.filter((e) => e.day <= st.day);
    st.events = st.events.filter((e) => e.day > st.day);
    const slotRank: Record<Slot, number> = { morning: 0, afternoon: 1, evening: 2 };
    today.sort((a, b) => slotRank[a.slot] - slotRank[b.slot]);

    this.pendingMeetings = [];
    for (const ev of today) {
      if (ev.kind === "meeting" && this.isPlayerMeeting(ev)) this.pendingMeetings.push(ev);
      else this.resolveOutcome(ev);
      // the calendar keeps its past: processed events go to the log (crossed out in the UI)
      st.eventLog.push(ev);
    }
    if (st.eventLog.length > 400) st.eventLog.splice(0, st.eventLog.length - 400);

    this.dailyEconomy();

    const d = calDate(st.day);
    if (d.dayOfWeek === 0) this.weeklyTick();
    if (d.dayOfWeek === 0 && d.weekOfSeason === 1 && st.day > DAYS_PER_WEEK) this.quarterlyBoard();

    // fail states
    if (this.player.cash <= 0 && !st.gameOver) {
      st.gameOver = { kind: "bankrupt", day: st.day };
    }
    return this.pendingMeetings;
  }

  private isPlayerMeeting(ev: SimEvent): boolean {
    return ev.kind === "meeting";
  }

  private dailyEconomy() {
    const E = this.content.economy;
    this.spend(0, E.overheadDaily);
    for (const m of this.state.movies) {
      if (m.phase === "prepro" || m.phase === "production" || m.phase === "post") {
        this.spend(m.studio, m.dailyCost);
        m.spent += m.dailyCost;
      }
    }
  }

  // ---------- weekly ----------
  private weeklyTick() {
    const st = this.state;
    const week = calDate(st.day).week + (calDate(st.day).year - 1) * 48;
    weeklyFadTick(this.rng.get("audience"), this.content, st.audience);
    // theatrical weekly grosses → this week's box office chart
    st.weekChart = [];
    for (const m of st.movies) {
      if (m.phase === "release" && m.releaseDay !== undefined) this.weeklyGross(m);
    }
    st.weekChart.sort((a, b) => b.gross - a.gross);
    // standings snapshots — REPORTED profit only: budgets post as a lump on release day
    for (const s of st.studios) s.history.push({ week, profit: s.totalRevenue - s.reportedSpend });
    this.standingsEmail();
    this.rivalBankruptcyCheck();
    this.maybeGossipColumn();
    this.scheduleAnnualEvents();
    this.scheduleStandups();
    // rival policy
    this.rivalPolicies();
    // production setbacks + diva demands
    for (const m of st.movies) {
      if (m.phase === "production") {
        this.maybeSetback(m);
        if (m.studio === 0) this.maybeDivaDemand(m);
      }
    }
    this.checkMandates();
    // annual "one that got away" recap
    const dNow = calDate(st.day);
    if (dNow.week === this.content.economy.regret.recapWeek && !st.flags[`recap_${dNow.year}`]) {
      st.flags[`recap_${dNow.year}`] = true;
      this.regretRecap();
    }
  }

  private maybeDivaDemand(m: Movie) {
    const rng = this.rng.get("setbacks");
    // script-approval clauses embolden people — the promise has a cost
    const approvalBoost = m.castIds.some((c) => this.state.flags[`scriptApproval_${m.id}_${c}`]) ? 1.8 : 1;
    if (!rng.chance(this.content.economy.production.divaDemandChancePerWeek * approvalBoost)) return;
    const cast = m.castIds.map((c) => this.person(c)!).filter(Boolean);
    const diva = cast.length ? rng.pickWeighted(cast, (c) => 100 - (c.cooperation ?? 50)) : this.person(m.directorId);
    if (!diva) return;
    const dlg = this.rng.get("dialogue");
    const demand = this.line("diva-demand", { name: diva.name });
    const cost = Math.round(m.budget * (0.01 + rng.next() * 0.03));
    this.pushEmail({
      from: `${this.person(m.producerId)?.name ?? "Set"} (re: ${diva.name})`,
      fromRole: "producer",
      format: "note",
      subject: `${m.title}: we have a situation (it has a rider)`,
      body: `${demand}\nIndulging this costs ${money(cost)}. Refusing costs... something less measurable.`,
      actions: [
        { id: "divaIndulge", label: `Indulge (${money(cost)} — keep the peace)` },
        { id: "divaRefuse", label: "Refuse (they'll remember, morale risk)" },
      ],
      ctx: { movieId: m.id, personId: diva.id, cost, demand },
    });
  }

  private checkMandates() {
    for (const md of this.state.mandates) {
      if (md.done || md.failed) continue;
      // completion checks
      if (md.kind === "releaseSeason") {
        const hit = this.state.movies.some(
          (m) => m.studio === 0 && m.releaseDay !== undefined && m.releaseDay <= this.state.day && calDate(m.releaseDay).season === md.param.season && m.releaseDay >= md.param.issuedDay
        );
        if (hit) md.done = true;
      } else if (md.kind === "beatRival") {
        // resolved at deadline only
      } else if (md.kind === "releaseCount") {
        const n = this.state.movies.filter((m) => m.studio === 0 && m.releaseDay !== undefined && m.releaseDay >= md.param.issuedDay).length;
        if (n >= md.param.count) md.done = true;
      }
      if (md.done) {
        this.state.patience = Math.min(100, this.state.patience + 6);
        this.pushEmail({
          from: "The Board",
          fromRole: "board",
          subject: `Mandate satisfied: consider the note closed`,
          body: `"${md.text}" — done. The board notices. The board rarely notices. Enjoy it.`,
          actions: [],
          ctx: {},
        });
        continue;
      }
      if (this.state.day >= md.deadlineDay) {
        let failed = true;
        if (md.kind === "beatRival") {
          const rival = this.state.studios.find((s) => s.name === md.param.rival);
          failed = !!rival && rival.totalRevenue - rival.reportedSpend > this.player.totalRevenue - this.player.reportedSpend;
        }
        md.failed = failed;
        md.done = !failed;
        this.state.patience += failed ? -8 : 4;
        this.pushEmail({
          from: "The Board",
          fromRole: "board",
          subject: failed ? "Mandate MISSED. The board is counting." : "Mandate closed out",
          body: failed
            ? `"${md.text}" — the deadline passed. The board's patience is not a renewable resource.`
            : `"${md.text}" — squared away at the wire.`,
          actions: [],
          ctx: {},
        });
      }
    }
  }

  private maybeGossipColumn() {
    const rng = this.rng.get("dialogue");
    if (!rng.chance(0.22)) return;
    const cols = this.columnists();
    const rivals = this.state.studios.filter((x) => !x.isPlayer && !x.bankrupt);
    if (!rivals.length) return;
    const rival = rng.pick(rivals);
    const someone = rng.pick(this.state.people.filter((x) => x.role === "cast" || x.role === "director"));
    const hotGenre = Object.entries(this.state.audience.fads).sort((a, b) => b[1] - a[1])[0][0];
    const items: [string, Intel["kind"], string | undefined][] = [
      [`${rival.name}'s ${hotGenre} picture is "a situation," per three people who'd know`, "flop", rival.name],
      [`${someone.name} was seen lunching OFF the lot. Twice. Draw conclusions`, "gossip", someone.id],
      [`${hotGenre} is "over," declares someone who was wrong about it last time`, "taste", undefined],
    ];
    const [text, kind, subjectId] = rng.pick(items);
    const reliable = rng.chance(0.65); // the gossip column is... directional
    this.addIntel(kind, subjectId, text, reliable);
    this.pushEmail({
      from: `${cols.gossip} — The Whisper Column`,
      fromRole: "trade",
      format: "clipping",
      subject: `WHISPERS: ${text.slice(0, 48)}…`,
      body: `${text}.
This column is never wrong. This column has been wrong twice this month.
(Filed as intel — spend it in a room, at your own risk.)
— ${cols.gossip}`,
      actions: [],
      ctx: {},
    });
  }

  private regretRecap() {
    const passed: { title: string; movieId?: string }[] = this.state.flags.passedPitches ?? [];
    const materialized = passed
      .map((p) => ({ p, m: this.state.movies.find((m) => m.id === p.movieId && m.releaseDay !== undefined) }))
      .filter((x) => x.m);
    if (!materialized.length) return;
    const lines = materialized.map(({ m }) => {
      const net = m!.revenue - m!.budget;
      return `• "${m!.title}" (${this.state.studios[m!.studio].name}) — ${money(m!.revenue)} gross, ${net >= 0 ? "profit" : "loss"} ${money(Math.abs(net))}. ${net > 10_000_000 ? "You said no." : "Dodged, honestly."}`;
    });
    this.pushEmail({
      from: "Varietal Trade Daily",
      fromRole: "trade",
      subject: "YEAR IN REVIEW: The Ones That Got Away",
      body: `Our annual accounting of projects that crossed your desk and kept walking:\n${lines.join("\n")}\n${this.line("regret-salt")}`,
      actions: [],
      ctx: {},
    });
  }

  private weeklyGross(m: Movie) {
    const E = this.content.economy.release;
    const weeksOut = Math.floor((this.state.day - (m.releaseDay ?? 0)) / DAYS_PER_WEEK);
    if (weeksOut < 0) return;
    if (weeksOut >= E.theatricalWeeks) {
      this.endTheatrical(m);
      return;
    }
    const funnel = this.state.flags[`funnel_${m.id}`] as FunnelResult | undefined;
    if (!funnel) return;
    const wom = (m.fanScore ?? 50) / 100;
    const decay = E.decay[weeksOut] * (0.7 + wom * 0.6);
    // competition: other releases in same week split the take
    const competing = this.state.movies.filter(
      (o) => o.id !== m.id && o.phase === "release" && o.releaseDay !== undefined && Math.abs((o.releaseDay ?? 0) - (m.releaseDay ?? 0)) < 14
    ).length;
    const compMod = 1 / (1 + competing * E.competitionSplit);
    const gross = funnel.gross * decay * compMod;
    m.weeklyGross.push(gross);
    this.state.weekChart.push({ movieId: m.id, gross });
    const cut = gross * (E.studioCut ?? 0.55);
    m.revenue += cut;
    this.earn(m.studio, cut);
  }

  private endTheatrical(m: Movie) {
    m.phase = "distribute";
    if (m.studio === 0) {
      const tiers = this.content.economy.distribute.priceTiers as any[];
      this.pushEmail({
        from: "Distribution Desk",
        fromRole: "distribution",
        subject: `${m.title}: home video window opens`,
        body: `Theatrical run's done at ${money(m.revenue)}. Retailers want numbers for the home release. Pick a price posture.`,
        actions: tiers.map((t) => ({ id: `dist_${t.id}`, label: t.label })),
        ctx: { movieId: m.id },
      });
    } else {
      this.scheduleHomeVideo(m, "standard");
    }
  }

  scheduleHomeVideo(m: Movie, tierId: string) {
    const D = this.content.economy.distribute;
    const tier = (D.priceTiers as any[]).find((t) => t.id === tierId) ?? D.priceTiers[1];
    this.addEvent(this.state.day + D.delayWeeks * DAYS_PER_WEEK, "morning", "outcome", "homeVideo", { movieId: m.id, tierId: tier.id });
  }

  // ---------- rivals ----------
  recordPass(pitch: PitchData) {
    const passed: any[] = (this.state.flags.passedPitches ??= []);
    passed.push({ title: pitch.title, pitch, day: this.state.day });
    if (passed.length > 20) passed.shift();
  }

  private rivalPolicies() {
    const R = this.content.economy.rivals;
    const rng = this.rng.get("rivals");
    for (let si = 1; si < this.state.studios.length; si++) {
      const s = this.state.studios[si];
      if (s.bankrupt) continue;
      const active = this.state.movies.filter((m) => m.studio === si && !["done", "cancelled"].includes(m.phase));
      if (active.length < R.maxConcurrent && s.cash > R.cashFloor && rng.chance(0.35 + (s.riskAppetite ?? 0.5) * 0.3)) {
        // sometimes they pick up exactly what you passed on — the trades will let you know
        const passed: any[] = this.state.flags.passedPitches ?? [];
        const adoptable = passed.filter((p) => !p.movieId && this.state.day - p.day > 10);
        let pitch: PitchData;
        let writer: Person;
        let fromPass: any = undefined;
        if (adoptable.length && rng.chance(this.content.economy.regret.adoptChance)) {
          fromPass = rng.pick(adoptable);
          pitch = fromPass.pitch;
          writer = this.state.people.find((p) => p.role === "writer")!;
        } else {
          writer = rng.pick(this.state.people.filter((p) => p.role === "writer"));
          pitch = mintPitch(rng, this.content, this.state, writer, si);
        }
        // budget discipline: cover the bet AND the runway to release
        if (s.cash < pitch.minBudget * R.budgetDiscipline) continue;
        const m = this.rivalGreenlight(si, writer, pitch, rng);
        if (fromPass && m) {
          fromPass.movieId = m.id;
          m.fromPassedPitch = true;
        }
      }
    }
  }

  /** Rivals live under the same gravity: sustained negative cash = fire-sale exit (+ optional replacement). */
  private rivalBankruptcyCheck() {
    const R = this.content.economy.rivals;
    for (let si = 1; si < this.state.studios.length; si++) {
      const s = this.state.studios[si];
      if (s.bankrupt) continue;
      const key = `rivalRed_${si}`;
      if (s.cash < 0) this.state.flags[key] = (this.state.flags[key] ?? 0) + 1;
      else this.state.flags[key] = 0;
      if ((this.state.flags[key] ?? 0) >= R.bankruptcyGraceWeeks) {
        s.bankrupt = true;
        const theirMovies = this.state.movies.filter((m) => m.studio === si && !["done", "cancelled"].includes(m.phase));
        for (const m of theirMovies) {
          m.phase = "cancelled";
          this.state.events = this.state.events.filter((e) => e.data.movieId !== m.id);
        }
        for (const p of this.state.people) {
          if (p.signedByStudio === si) {
            p.signedByStudio = undefined;
            p.busyUntil = this.state.day;
          }
        }
        const dlg = this.rng.get("dialogue");
        this.pushEmail({
          from: "Varietal Trade Daily",
          fromRole: "trade",
          subject: `${s.name} COLLAPSES — fire sale on the lot`,
          body: `${s.name} has shuttered. ${theirMovies.length} project${theirMovies.length === 1 ? "" : "s"} dead in the water, talent contracts voided — every name on their roster is suddenly free and taking calls.\n${bankLine(dlg, this.content, "news-closer")}`,
          actions: [],
          ctx: {},
        });
        if (R.replacementEntry) {
          this.addEvent(this.weekday(this.state.day + 28), "morning", "outcome", "newStudioEntry", {});
        }
      }
    }
  }

  outcome_newStudioEntry(_ev: SimEvent) {
    const rng = this.rng.get("rivals");
    const banks = this.content.people.nameBanks;
    const used = new Set(this.state.studios.map((s) => s.name));
    let name = "";
    for (let i = 0; i < 20 && (!name || used.has(name)); i++) {
      name = `${rng.pick(banks.last as string[])} ${rng.pick(["Pictures", "Studios", "Films", "Entertainment", "Media"])}`;
    }
    if (used.has(name)) return;
    this.state.studios.push({
      name,
      cash: this.content.economy.rivals.startingCash,
      isPlayer: false,
      persona: rng.pick(["aggressive", "prestige", "cheap", "franchise", "chaotic"]),
      riskAppetite: 0.3 + rng.next() * 0.6,
      history: [],
      totalRevenue: 0,
      totalSpent: 0,
      reportedSpend: 0,
    });
    this.pushEmail({
      from: "Varietal Trade Daily",
      fromRole: "trade",
      subject: `New money in town: ${name}`,
      body: `A fresh shingle goes up where the last one burned down. ${name} opens with deep pockets and no scars. Yet.`,
      actions: [],
      ctx: {},
    });
  }

  private rivalGreenlight(si: number, writer: Person, pitch: PitchData, rng: Rng): Movie {
    const m = this.createMovie(si, writer, pitch);
    // rivals sign talent immediately (scarcity is real)
    const director = this.person(pitch.idealDirectorId);
    if (director && director.busyUntil <= this.state.day) {
      m.directorId = director.id;
    } else {
      const free = this.state.people.filter((p) => p.role === "director" && p.busyUntil <= this.state.day);
      if (free.length) m.directorId = rng.pick(free).id;
    }
    const freeCast = this.state.people.filter((p) => p.role === "cast" && p.busyUntil <= this.state.day);
    m.castIds = rng
      .shuffle([...freeCast])
      .slice(0, Math.min(2, freeCast.length))
      .map((c) => c.id);
    const totalDays = this.estimateTimeline(m);
    for (const cid of [...m.castIds, m.directorId].filter(Boolean) as string[]) {
      const p = this.person(cid)!;
      p.busyUntil = this.state.day + totalDays;
      p.signedByStudio = si;
    }
    m.phase = "production"; // rivals compress pre-phases; costs charged up front
    m.phaseStart = this.state.day;
    m.phaseEnd = this.state.day + totalDays;
    m.budget = Math.round(pitch.minBudget * (0.9 + rng.next() * 0.4));
    m.dailyCost = Math.round((m.budget * this.content.economy.production.baseDailyCostFactor) / 1000) * 1000;
    this.spend(si, m.budget * 0.2); // greenlight lump; dailies cover the rest of the shoot
    this.addEvent(m.phaseEnd, "afternoon", "outcome", "rivalWrap", { movieId: m.id });
    // news for the player — every rival move is a lesson
    const stolen = m.castIds.some((c) => this.state.flags[`playerWanted_${c}`]);
    this.newsEmail("greenlight", {
      rival: this.state.studios[si].name,
      title: m.title,
      genre: m.genre,
      director: this.person(m.directorId)?.name ?? "TBD",
      salt: stolen,
    });
    return m;
  }

  private estimateTimeline(m: Movie): number {
    const E = this.content.economy;
    const director = this.person(m.directorId);
    const locations = director?.avgLocations ?? 5;
    m.locations = locations;
    const prodDays = Math.round(locations * E.production.baseDaysPerLocation);
    const postDays = E.post.baseDays + Math.round(m.estVfx / 12);
    return prodDays + postDays;
  }

  // ---------- movie creation & player pipeline ----------
  createMovie(studio: number, writer: Person, pitch: PitchData): Movie {
    const m: Movie = {
      id: this.id("mv"),
      studio,
      title: pitch.title,
      genre: pitch.genre,
      subgenre: pitch.subgenre,
      estRating: pitch.estRating,
      franchise: pitch.franchise,
      sequelOf: pitch.sequelOf,
      writerId: writer.id,
      castIds: [],
      idealCastIds: pitch.idealCastIds,
      directorId: undefined,
      targetLength: pitch.targetLength,
      minBudget: pitch.minBudget,
      estVfx: pitch.estVfx,
      phase: "pitch",
      phaseStart: this.state.day,
      phaseEnd: this.state.day,
      budget: pitch.minBudget,
      spent: 0,
      dailyCost: 0,
      locations: 5,
      quality: { script: 0, direction: 0, performance: 0, vfx: 0, polish: 0 },
      pitchLogline: pitch.logline,
      estRevenue: this.estimateRevenue(pitch.minBudget, pitch.genre),
      hype: 15,
      marketing: 0,
      weeklyGross: [],
      revenue: 0,
      homeRevenue: 0,
      reviews: [],
      setbackCount: 0,
      awards: [],
      incidents: [],
      pressTours: 0,
    };
    this.state.movies.push(m);
    return m;
  }

  /** Utility-selected bank line: context tags (tone, genre, season…) steer which lines
   *  surface; a no-repeat window keeps it fresh. THE standard way to pick text. */
  line(bank: string, ctx: Record<string, any> = {}): string {
    const mem: Record<string, string[]> = (this.state.flags._recentLines ??= {});
    const recent = (mem[bank] ??= []);
    const entries = (this.content.templates.banks as Record<string, any[]>)[bank];
    if (!entries?.length) return `[missing bank: ${bank}]`;
    const d = calDate(this.state.day);
    const fullCtx = { season: SEASONS[d.season], tier: ["warm", "curt", "cold", "hostile"][this.toneTier()], ...ctx };
    const out = fill(selectLine(this.rng.get("dialogue"), entries, fullCtx, recent), ctx);
    recent.push(out);
    if (recent.length > 4) recent.shift();
    return out;
  }

  private scheduleWriterPitch(writer: Person, inDays: number) {
    this.addEvent(this.weekday(this.state.day + inDays), "morning", "outcome", "writerPitch", { writerId: writer.id });
  }

  // ---------- outcomes ----------
  resolveOutcome(ev: SimEvent) {
    const h = (this as any)[`outcome_${ev.type}`];
    if (typeof h === "function") h.call(this, ev);
  }

  outcome_writerPitch(ev: SimEvent) {
    const writer = this.person(ev.data.writerId);
    if (!writer) return;
    const rng = this.rng.get("pitches");
    const pitch = mintPitch(rng, this.content, this.state, writer, 0);
    const tone = writer.relationship > 20 ? "warm" : writer.relationship < -10 ? "cold" : "neutral";
    const greeting = this.line(`pitch-greeting-${tone}`);
    const director = this.person(pitch.idealDirectorId);
    const roughDays = Math.round((director?.avgLocations ?? 5) * this.content.economy.production.baseDaysPerLocation + this.content.economy.post.baseDays + 40);
    const frame = this.line("pitch-frame", {
      greeting,
      title: pitch.title,
      genre: `${pitch.genre}/${pitch.subgenre}`,
      logline: pitch.logline,
      titleWords: pitch.title.split(/\s+/).length,
    });
    const rivalName = this.state.studios.filter((s) => !s.isPlayer && !s.bankrupt)[0]?.name ?? "the other guys";
    const body = `${frame}${pitch.franchise ? ` This slots right into ${pitch.franchise}.` : ""}\nBallpark: ${money(pitch.minBudget)} minimum budget · ~${money(
      this.estimateRevenue(pitch.minBudget, pitch.genre)
    )} box office if we don't blow it · roughly ${Math.round(roughDays / 7)} weeks pitch-to-print.\nGreenlighting a script runs ${money(
      pitch.minBudget * this.content.economy.phases.greenlightScriptFactor
    )}. ${this.line("pitch-close", { rival: rivalName })} ${this.line("writer-signoff")}`;
    this.pushEmail({
      from: writer.name,
      fromRole: "writer",
      subject: this.line("pitch-subject", { hook: pitch.hook }),
      body: voiceWrap(this.content, writer, body, this.state.day),
      actions: [
        { id: "scheduleMeeting", label: "Schedule Pitch Meeting" },
        { id: "ignore", label: "Ignore" },
      ],
      ctx: { writerId: writer.id, pitch },
    });
    // flywheel
    const W = this.content.economy.writers.pitchIntervalDays;
    this.scheduleWriterPitch(writer, this.rng.get("pitches").int(W[0] * 2, W[1] * 2));
  }

  outcome_scriptDone(ev: SimEvent) {
    const m = this.movie(ev.data.movieId);
    if (!m || m.phase !== "script") return;
    const writer = this.person(m.writerId)!;
    const rng = this.rng.get("quality");
    const genreFit = writer.capableGenres?.includes(m.genre) ? 1 : 0.75;
    m.quality.script = Math.max(5, Math.min(100, (writer.avgRating ?? 50) * genreFit + rng.gaussian(0, 8)));
    if (m.studio === 0) this.scriptPackageEmail(m);
  }

  /** The script package: everything from the pitch + attachments + producer assignment gate. */
  scriptPackageEmail(m: Movie) {
    const writer = this.person(m.writerId)!;
    const E = this.content.economy.phases;
    const cost = Math.round(m.minBudget * E.greenlightPreproFactor);
    const director = this.person(m.directorId ?? (m as any).idealDirectorId);
    const proposedCast = m.idealCastIds.map((c) => this.person(c)).filter(Boolean) as Person[];
    const prodDays = Math.round(((director?.avgLocations ?? 5) * this.content.economy.production.baseDaysPerLocation));
    const soonest = this.state.day + this.content.economy.phases.preproDays[0] + prodDays + this.content.economy.post.baseDays + 21;
    const d = calDate(this.weekday(soonest));
    const body =
      `Pages attached. My best work since the last one.\n` +
      `— ${m.title} (${m.genre}/${m.subgenre}, ${m.estRating}) · "${m.pitchLogline ?? "you read the pitch"}"\n` +
      `— Director attached: ${director ? `${director.name} (${director.archetype.replace(/-/g, " ")})` : "TBD"}\n` +
      `— Proposed cast: ${proposedCast.length ? proposedCast.map((c) => c.name).join(", ") : "open call"}\n` +
      `— Target ${m.targetLength} min · ~${m.estVfx} VFX shots · minimum budget ${money(m.minBudget)}\n` +
      `— Projected box office: ~${money(m.estRevenue ?? this.estimateRevenue(m.minBudget, m.genre))}\n` +
      `— Soonest realistic release: WK ${d.week} ${SEASONS[d.season]} YR ${d.year}\n\n` +
      `Pre-production needs a PRODUCER on it (${money(cost)} to greenlight). Current staff loads below.`;
    const producers = this.staffProducers();
    const actions = producers.map((p) => ({
      id: `assignProducer_${p.id}`,
      label: `Assign ${p.name} (${this.producerLoad(p.id)} active${this.producerLoad(p.id) > this.content.economy.producers.idealLoad - 1 ? " ⚠" : ""}) — ${money(cost)}`,
    }));
    actions.push({ id: "park", label: "Park in Development (no burn, wait for a producer)" });
    actions.push({ id: "abandon", label: "Shelve It (write off)" });
    this.pushEmail({
      from: writer.name,
      fromRole: "writer",
      subject: `${m.title}: the script is DONE`,
      body,
      actions,
      ctx: { movieId: m.id },
    });
  }

  outcome_preproDone(ev: SimEvent) {
    const m = this.movie(ev.data.movieId);
    if (!m || m.phase !== "prepro") return;
    const producer = this.person(m.producerId)!;
    // casting gate: production never starts uncast — the producer fills gaps with free workhorses
    let autofilled: string[] = [];
    if (m.castIds.length === 0) {
      const free = this.state.people
        .filter((p) => p.role === "cast" && p.busyUntil <= this.state.day)
        .sort((a, b) => (a.dailyRate ?? 0) - (b.dailyRate ?? 0))
        .slice(0, 2);
      for (const c of free) {
        m.castIds.push(c.id);
        c.busyUntil = this.state.day + 120;
        c.signedByStudio = 0;
        autofilled.push(c.name);
      }
    }
    const director = this.person(m.directorId);
    const overload = this.overloadFactor(m.producerId);
    this.estimateTimeline(m);
    const budget = Math.round(m.minBudget * (producer.avgProdCost ?? 1) * overload * (director ? 1 + ((director.avgVfxShots ?? 100) - m.estVfx) / 4000 : 1));
    m.budget = Math.max(m.minBudget * 0.8, budget);
    const E = this.content.economy.phases;
    const cost = Math.round(m.budget * E.greenlightProductionFactor);
    m.dailyCost = Math.round((m.budget * this.content.economy.production.baseDailyCostFactor * overload) / 1000) * 1000;
    const prodDays = Math.round(m.locations * this.content.economy.production.baseDaysPerLocation * (producer.avgProdLength ?? 1) * overload);
    // build the shot list: per-location blocks with cast requirements
    const rng = this.rng.get("schedule");
    const blocks = [] as NonNullable<Movie["shotList"]>;
    let daysLeft = prodDays;
    for (let loc = 1; loc <= m.locations; loc++) {
      const d = loc === m.locations ? daysLeft : Math.max(2, Math.round(prodDays / m.locations + rng.int(-2, 2)));
      daysLeft -= d;
      const castNeeded = m.castIds.filter(() => rng.chance(0.75));
      blocks.push({ location: loc, days: d, castIds: castNeeded.length ? castNeeded : m.castIds.slice(0, 1) });
    }
    m.shotList = blocks;
    m.estRevenue = this.estimateRevenue(m.budget, m.genre);
    const relDay = this.weekday(this.state.day + prodDays + this.content.economy.post.baseDays + Math.round(m.estVfx / 12) + 21);
    const rd = calDate(relDay);
    this.pushEmail({
      from: producer.name,
      fromRole: "producer",
      subject: `${m.title}: pre-production wrapped — full plan attached`,
      body:
        `${autofilled.length ? `Casting gaps filled with ${autofilled.join(" and ")} (best available — don't make that face). ` : "Cast locked. "}` +
        `Locations scouted (${m.locations}), shot list drafted${overload > 1 ? ` (I am spread across ${this.producerLoad(m.producerId!)} projects, numbers reflect that)` : ""}.\n` +
        `Actual budget: ${money(m.budget)} · ~${prodDays} days at ${money(m.dailyCost)}/day · greenlight: ${money(cost)}.\n` +
        `Estimated release: WK ${rd.week} ${SEASONS[rd.season]} YR ${rd.year} · projected box office ~${money(m.estRevenue)}.\n` +
        `Open the ${m.title} dossier for the full production plan (shot schedule, cast availability, projections).`,
      actions: [
        { id: "approveProduction", label: `Greenlight Production (${money(cost)})` },
        { id: "abandon", label: "Kill It Here (write off)" },
      ],
      ctx: { movieId: m.id, prodDays },
    });
  }

  outcome_productionWrap(ev: SimEvent) {
    const m = this.movie(ev.data.movieId);
    if (!m || m.phase !== "production") return;
    const rng = this.rng.get("quality");
    const director = this.person(m.directorId);
    const cast = m.castIds.map((c) => this.person(c)!).filter(Boolean);
    m.quality.direction = Math.max(5, Math.min(100, (director?.avgRating ?? 45) + rng.gaussian(0, 7)));
    const castAvg = cast.length ? cast.reduce((s, c) => s + (c.avgRating ?? 50), 0) / cast.length : 40;
    const friction = m.setbackCount * 3;
    m.quality.performance = Math.max(5, Math.min(100, castAvg - friction + rng.gaussian(0, 6)));
    m.actualVfx = Math.round(m.estVfx * (0.8 + rng.next() * 0.5) + (director?.avgVfxShots ?? 100) * 0.1);
    m.phase = "post";
    m.phaseStart = this.state.day;
    if (m.studio === 0) {
      const options = this.rng.get("people").shuffle([...this.state.vfxStudios]).slice(0, 3);
      this.pushEmail({
        from: this.person(m.producerId)?.name ?? "Production Office",
        fromRole: "producer",
        subject: `${m.title}: that's a wrap. Now the fun part (VFX bids)`,
        body: `Principal photography's done. ${m.actualVfx} VFX shots on the list (we estimated ${m.estVfx} — ${
          m.actualVfx! > m.estVfx ? "the director found some inspiration, sorry" : "under estimate, frame this email"
        }). Bids in:\n${options
          .map((o) => `• ${o.name} — ${money(o.dailyCost)}/day, ~${o.maxDailyShots} shots/day, quality rep ${o.avgRating}/100`)
          .join("\n")}`,
        actions: options.map((o) => ({ id: `vfx_${o.id}`, label: `Hire ${o.name}` })),
        ctx: { movieId: m.id },
      });
    }
  }

  outcome_vfxDone(ev: SimEvent) {
    const m = this.movie(ev.data.movieId);
    if (!m || m.phase !== "post") return;
    // picture's locked — burn drops to finishing overhead until release
    m.dailyCost = Math.max(5000, Math.round((m.budget * 0.001) / 500) * 500);
    const vfx = this.state.vfxStudios.find((v) => v.id === m.vfxStudioId);
    const rng = this.rng.get("quality");
    m.quality.vfx = Math.max(5, Math.min(100, (vfx?.avgRating ?? 40) + rng.gaussian(0, 6)));
    const producer = this.person(m.producerId);
    m.quality.polish = Math.max(5, Math.min(100, (producer?.avgRating ?? 50) + rng.gaussian(0, 8)));
    // screening
    const q = this.movieQuality(m);
    m.screeningScore = Math.max(5, Math.min(100, q + rng.gaussian(0, 10)));
    const dlg = this.rng.get("dialogue");
    const T = this.content.economy.triage;
    if (m.screeningScore < T.screeningThreshold) {
      // the movie is broken. Welcome to the most executive decision in the business.
      const reshootCost = Math.round(m.budget * T.reshootCostFactor);
      const recutCost = Math.round(m.budget * T.recutCostFactor);
      const sellPrice = Math.round(m.spent * T.selloffFactor);
      this.pushEmail({
        from: this.person(m.producerId)?.name ?? "Production Office",
        fromRole: "producer",
        subject: `${m.title}: the screening was... let's talk options`,
        body: `${bankLine(dlg, this.content, "screening-bad")}\nScreening score: ${Math.round(m.screeningScore)}/100. Sunk so far: ${money(m.spent)}.\nWhat do we do with a broken movie? Everything's on the table:`,
        actions: [
          { id: "triage_reshoot", label: `Order reshoots (${money(reshootCost)}, +${T.reshootDelayDays} days — real fix, real money)` },
          { id: "triage_recut", label: `Recut in-house (${money(recutCost)} — cheap polish, modest hope)` },
          { id: "triage_dump", label: `Dump it in a quiet window (minimal marketing, cut losses)` },
          { id: "triage_sell", label: `Sell it off (${money(sellPrice)} cash now — someone else's problem, and maybe their hit)` },
          { id: "triage_push", label: `Push through anyway (full campaign, pray)` },
        ],
        ctx: { movieId: m.id, reshootCost, recutCost, sellPrice },
      });
      return;
    }
    const verdict = m.screeningScore > 65 ? "good" : "mixed";
    this.marketingEmail(m, `${bankLine(dlg, this.content, `screening-${verdict}`)}\nScreening score: ${Math.round(m.screeningScore)}/100.`, true);
  }

  marketingEmail(m: Movie, preface: string, offerTest: boolean) {
    const tiers = this.content.economy.post.marketingTiers as any[];
    const TS = this.content.economy.testScreening;
    const actions = tiers.map((t) => ({ id: `mkt_${t.id}`, label: `${t.label} (${money(t.cost)})` }));
    if (offerTest && !m.testScreened) actions.unshift({ id: "testScreening", label: `Run a segment test screening first (${money(TS.cost)} — know your audience before you spend)` });
    this.pushEmail({
      from: this.person(m.producerId)?.name ?? "Production Office",
      fromRole: "producer",
      subject: `${m.title}: marketing wants a number`,
      body: `${preface}\nMarketing wants a budget:\n${tiers.map((t) => `• ${t.label} — ${money(t.cost)}`).join("\n")}`,
      actions,
      ctx: { movieId: m.id },
    });
  }

  outcome_release(ev: SimEvent) {
    const m = this.movie(ev.data.movieId);
    if (!m || (m.phase !== "post" && m.phase !== "release")) return;
    m.phase = "release";
    m.releaseDay = this.state.day;
    // the books open: full budget + campaign posts to the public standings as one lump
    this.state.studios[m.studio].reportedSpend += m.budget + m.marketing;
    if (m.studio === 0 && m.announcedRelease !== undefined) {
      this.rep("onTime", this.state.day <= m.announcedRelease + 3 ? 2 : -3);
    }
    this.generateReviews(m);
    const tier = (this.content.economy.post.marketingTiers as any[]).find((t) => t.id === ev.data.marketingTier) ?? { reach: 0.4 };
    const funnel = computeFunnel(this.content, this.state, m, tier.reach);
    this.state.flags[`funnel_${m.id}`] = funnel;
    m.theaters = Math.round(Math.min(this.content.economy.release.theatersMax, 400 + funnel.interested * 90));
    discover(this.content, this.state, m);
    // opening weekend = week 0 gross, applied immediately
    this.weeklyGross(m);
    const stars = m.reviews.length ? m.reviews.reduce((s, r) => s + r.stars, 0) / m.reviews.length : 2.5;
    const opening = m.weeklyGross[0] ?? 0;
    if (m.studio === 0) {
      const dlg = this.rng.get("dialogue");
      const verdictBank = opening > m.budget * 0.35 ? "opening-verdict-hit" : opening > m.budget * 0.15 ? "opening-verdict-ok" : "opening-verdict-flop";
      this.pushEmail({
        from: "The Numbers",
        fromRole: "trade",
        subject: `${m.title} opens: ${money(opening)}`,
        body: `${bankLine(dlg, this.content, verdictBank)}\nTheaters: ${m.theaters}. Critics: ${stars.toFixed(1)}★. Fan score: ${Math.round(
          m.fanScore ?? 0
        )}.\nFull funnel attached.`,
        actions: [],
        ctx: { movieId: m.id },
        embed: { kind: "funnel", movieId: m.id },
      });
      if (opening < m.budget * 0.12) {
        this.state.patience -= this.content.economy.patienceFlopHit;
      }
      if (stars >= 4) this.rep("prestige", 3);
      else if (stars <= 2) this.rep("prestige", -2);
      // premiere night: you're going, it's your movie
      this.addEvent(this.state.day, "evening", "meeting", "premiere", { movieId: m.id });
      // critic review emails (top 2)
      for (const r of m.reviews.slice(0, 2)) {
        const critic = this.person(r.criticId)!;
        this.pushEmail({
          from: `${critic.name}, ${critic.outlet}`,
          fromRole: "critic",
          subject: `"${m.title}" review — ${r.stars}★/5`,
          body: r.quote,
          actions: [],
          ctx: { movieId: m.id },
        });
      }
    } else {
      this.newsEmail("release", { rival: this.state.studios[m.studio].name, title: m.title, gross: money(opening), tier: opening > m.budget * 0.35 ? "hit" : opening > m.budget * 0.15 ? "ok" : "flop" });
      if (m.fromPassedPitch && opening > m.budget * 0.2) {
        this.pushEmail({
          from: "Varietal Trade Daily",
          fromRole: "trade",
          subject: `About "${m.title}"... this one stings`,
          body: `"${m.title}" opened to ${money(opening)} for ${this.state.studios[m.studio].name}.\n${this.line("regret-salt")}`,
          actions: [],
          ctx: { movieId: m.id },
        });
      }
      discover(this.content, this.state, m);
    }
  }

  outcome_rivalWrap(ev: SimEvent) {
    const m = this.movie(ev.data.movieId);
    if (!m || m.phase !== "production") {
      // rivals set phase production; treat wrap → straight to release in 4 weeks
    }
    if (!m) return;
    const rng = this.rng.get("quality");
    const director = this.person(m.directorId);
    const cast = m.castIds.map((c) => this.person(c)!).filter(Boolean);
    m.quality.script = Math.max(5, Math.min(100, (this.person(m.writerId)?.avgRating ?? 50) + rng.gaussian(0, 8)));
    m.quality.direction = Math.max(5, Math.min(100, (director?.avgRating ?? 45) + rng.gaussian(0, 7)));
    m.quality.performance = Math.max(5, Math.min(100, (cast.length ? cast.reduce((s, c) => s + (c.avgRating ?? 50), 0) / cast.length : 40) + rng.gaussian(0, 6)));
    m.quality.vfx = Math.max(5, Math.min(100, 50 + rng.gaussian(0, 10)));
    m.quality.polish = Math.max(5, Math.min(100, 50 + rng.gaussian(0, 10)));
    m.actualVfx = m.estVfx;
    m.hype = 30 + rng.int(0, 40);
    m.phase = "post";
    this.spend(m.studio, m.budget * 0.1 + 3000000); // finishing costs + a standard campaign
    const releaseIn = 21 + rng.int(0, 21);
    const relEv = this.addEvent(this.state.day + releaseIn, "morning", "outcome", "release", { movieId: m.id, marketingTier: "standard" });
    // rivals ANNOUNCE their dates — the corridor is public information
    m.announcedRelease = relEv.day;
    const rd = calDate(relEv.day);
    this.pushEmail({
      from: "Varietal Trade Daily",
      fromRole: "trade",
      subject: `${this.state.studios[m.studio].name} dates "${m.title}" — WK ${rd.week}`,
      body: `${this.state.studios[m.studio].name} has staked out WK ${rd.week} ${SEASONS[rd.season]} for "${m.title}" (${m.genre}). The corridor takes shape. Plan accordingly, or don't — that's also a plan.`,
      actions: [],
      ctx: { movieId: m.id },
    });
    for (const cid of [...m.castIds, m.directorId].filter(Boolean) as string[]) {
      const p = this.person(cid)!;
      p.busyUntil = this.state.day;
      p.signedByStudio = undefined;
    }
  }

  outcome_homeVideo(ev: SimEvent) {
    const m = this.movie(ev.data.movieId);
    if (!m) return;
    const D = this.content.economy.distribute;
    const tier = (D.priceTiers as any[]).find((t) => t.id === ev.data.tierId) ?? D.priceTiers[1];
    const funnel = this.state.flags[`funnel_${m.id}`] as FunnelResult | undefined;
    if (!funnel) return;
    const wom = (m.fanScore ?? 50) / 100;
    const wholesaleUnits = funnel.wholesale * 1e6 * tier.volumeMult * (0.6 + wom * 0.8);
    const retailUnits = funnel.retail * 1e6 * tier.volumeMult * (0.5 + wom);
    const revenue = wholesaleUnits * D.unitPriceWholesale * tier.mult + retailUnits * D.unitPriceRetail * tier.mult * 0.4;
    m.homeRevenue = revenue;
    m.revenue += revenue;
    this.earn(m.studio, revenue);
    m.phase = "done";
    if (m.studio === 0) {
      // backend points collect here — the promise pays out
      for (const pr of this.state.promises!.filter((x) => x.kind === "backend" && x.movieId === m.id && !x.honored && !x.broken)) {
        const net = m.revenue - m.budget;
        if (net > 0) {
          const cut = Math.round(net * 0.06);
          this.spend(0, cut);
          this.honorPromise(pr, `backend points on "${m.title}" (${money(cut)} paid out)`);
        } else pr.honored = true;
      }
    }
    // free talent
    for (const cid of [...m.castIds, m.directorId].filter(Boolean) as string[]) {
      const p = this.person(cid)!;
      if (p.busyUntil > this.state.day) p.busyUntil = this.state.day;
      p.signedByStudio = undefined;
    }
    this.addCredits(m);
    if (m.studio === 0 && m.producerId) this.notifyParkedMovies(`${this.person(m.producerId)?.name ?? "A producer"} just wrapped ${m.title}.`);
    if (m.studio === 0) {
      this.pushEmail({
        from: "Distribution Desk",
        fromRole: "distribution",
        subject: `${m.title}: home video numbers`,
        body: `${count(wholesaleUnits)} units wholesale, ${count(retailUnits)} retail. Home revenue: ${money(revenue)}.\nFinal tally — total revenue ${money(m.revenue)} against ${money(m.budget)} budget: ${
          m.revenue - m.budget >= 0 ? "profit" : "loss"
        } of ${money(Math.abs(m.revenue - m.budget))}.`,
        actions: [],
        ctx: { movieId: m.id },
      });
      this.maybeSequel(m);
    }
  }

  private addCredits(m: Movie) {
    const stars = m.reviews.length ? m.reviews.reduce((s, r) => s + r.stars, 0) / m.reviews.length : 2.5;
    const year = calDate(this.state.day).year;
    const profit = m.revenue - m.budget;
    const credit = (p: Person | undefined, role: any) => {
      if (!p) return;
      p.filmography.push({ movieId: m.id, title: m.title, role, year, stars, profit });
      if (p.fame !== undefined) p.fame = Math.min(100, p.fame + (stars > 3.5 ? 6 : stars < 2 ? -4 : 1));
    };
    credit(this.person(m.writerId), "writer");
    credit(this.person(m.directorId), "director");
    for (const c of m.castIds) credit(this.person(c), "cast");
    credit(this.person(m.producerId), "producer");
  }

  private maybeSequel(m: Movie) {
    const S = this.content.economy.sequel;
    if (m.revenue - m.budget < S.minProfit || (m.fanScore ?? 0) < S.fanScoreMin) return;
    const writer = this.person(m.writerId);
    if (!writer) return;
    const pitch = mintSequelPitch(this.rng.get("pitches"), this.content, this.state, m);
    this.pushEmail({
      from: writer.name,
      fromRole: "writer",
      subject: `The ${m.title} sequel writes itself (I still charge)`,
      body: `The numbers are in and the audience wants more. ${pitch.title}: ${pitch.logline}. Minimum budget ${money(pitch.minBudget)} — sequels aren't cheap, but the fans are pre-sold.`,
      actions: [
        { id: "scheduleMeeting", label: "Schedule Pitch Meeting" },
        { id: "ignore", label: "Ignore" },
      ],
      ctx: { writerId: writer.id, pitch },
    });
  }

  outcome_setbackResolved(ev: SimEvent) {
    const m = this.movie(ev.data.movieId);
    if (!m || m.phase !== "production") return;
    // production resumes; wrap date already pushed when the setback was accepted
  }

  // ---------- setbacks ----------
  private maybeSetback(m: Movie) {
    const P = this.content.economy.production;
    const rng = this.rng.get("setbacks");
    const cast = m.castIds.map((c) => this.person(c)!).filter(Boolean);
    const coopAvg = cast.length ? cast.reduce((s, c) => s + (c.cooperation ?? 60), 0) / cast.length : 60;
    const chance = P.setbackChancePerWeek * (1 + ((60 - coopAvg) / 60) * P.cooperationSetbackWeight);
    if (!rng.chance(chance)) return;
    const kinds = this.content.setbacks.kinds as Record<string, any>;
    const kindId = rng.pickWeighted(Object.keys(kinds), (k) => kinds[k].weight);
    const K = kinds[kindId];
    const delay = rng.int(K.delayDays[0], K.delayDays[1]);
    const cost = Math.round(m.budget * (K.costFactor[0] + rng.next() * (K.costFactor[1] - K.costFactor[0])));
    m.setbackCount++;
    if (m.studio !== 0) {
      // rivals auto-absorb
      this.spend(m.studio, cost);
      m.phaseEnd += delay;
      const wrapEv = this.state.events.find((e) => e.type === "rivalWrap" && e.data.movieId === m.id);
      if (wrapEv) wrapEv.day += delay;
      return;
    }
    const dlg = this.rng.get("dialogue");
    const producer = this.person(m.producerId);
    const victim = kindId === "directorRecall" ? this.person(m.directorId) : cast.length ? rng.pick(cast) : undefined;
    const ctxMap: Record<string, any> = {
      director: victim?.name ?? "the director",
      cast: victim?.name ?? "the lead",
      location: "location",
      equipment: bankLine(dlg, this.content, "equipment-item"),
    };
    const subjBank = `setback-subject-${kindId}`;
    let detail = "";
    if (kindId === "directorRecall") detail = `${victim?.name ?? "The director"} ${bankLine(dlg, this.content, "director-recall-reason")}.`;
    else if (kindId === "castInjury" || kindId === "castDispute") {
      detail = `${victim?.name ?? "The lead"} ${bankLine(dlg, this.content, "cast-incident")}.`;
      if ((victim?.cooperation ?? 100) < 40) detail += ` ${bankLine(dlg, this.content, "told-you-so")}`;
    } else if (kindId === "location") detail = `The location is ${bankLine(dlg, this.content, "location-problem")}`;
    else detail = `The ${ctxMap.equipment} is ${bankLine(dlg, this.content, "equipment-fate")}.`;
    const spin = bankLine(dlg, this.content, `producer-spin-${producer?.archetype ?? "steady-hand"}`);
    m.incidents.push({ day: this.state.day, kind: kindId, text: detail, cost, delay });
    this.pushEmail({
      from: `${producer?.name ?? "Production Office"} (on set, ${m.title})`,
      fromRole: "producer",
      subject: bankLine(dlg, this.content, subjBank, ctxMap),
      body: `${bankLine(dlg, this.content, "setback-open")} ${detail}\nDamage: ${delay} days, ${money(cost)}. ${spin}`,
      actions: [
        { id: "expandBudget", label: `Expand Budget (${money(cost)})` },
        { id: "cancelProject", label: `Cancel Project (write off ${money(m.spent)})` },
      ],
      ctx: { movieId: m.id, delay, cost },
    });
  }

  // ---------- reviews / quality ----------
  movieQuality(m: Movie): number {
    const q = m.quality;
    const vfxWeight = Math.min(0.3, (m.actualVfx ?? m.estVfx) / 1500);
    const base = q.script * 0.28 + q.direction * 0.24 + q.performance * 0.24 + q.polish * (0.24 - vfxWeight) + q.vfx * vfxWeight;
    return base;
  }

  private generateReviews(m: Movie) {
    const critics = this.state.people.filter((p) => p.role === "critic");
    const rng = this.rng.get("reviews");
    const dlg = this.rng.get("dialogue");
    const q = this.movieQuality(m);
    m.reviews = critics.map((c) => {
      const bias = (c.genreBias?.[m.genre] ?? 0) * 0.5;
      const fallBonus = calDate(this.state.day).season === 3 && m.genre === "Drama" ? 0.3 : 0;
      let stars = q / 20 + bias + fallBonus - (c.harshness ?? 0.4) + rng.gaussian(0, 0.5);
      stars = Math.max(0.5, Math.min(5, Math.round(stars * 2) / 2));
      const sTier = Math.max(1, Math.min(5, Math.round(stars)));
      const cast = this.person(m.castIds[0]);
      const perf = stars >= 4 ? "great" : stars >= 2.5 ? "fine" : "poor";
      const quote = `"${bankLine(dlg, this.content, `review-open-${sTier}`, { runtime: m.targetLength })} ${cast ? `${cast.name} ${bankLine(dlg, this.content, `performance-verdict-${perf}`)}.` : ""} ${bankLine(dlg, this.content, `review-close-${sTier}`)}"`;
      return { criticId: c.id, stars, quote };
    });
    const improv = m.castIds.map((c) => this.person(c)?.improv ?? 50).reduce((a, b) => a + b, 0) / Math.max(1, m.castIds.length);
    m.fanScore = Math.max(5, Math.min(100, q * 0.7 + m.hype * 0.15 + improv * 0.15 + rng.gaussian(0, 6)));
  }

  // ---------- board / quarterly ----------
  private quarterlyBoard() {
    // board review meeting early each season (weekday-booked)
    this.bookMeeting(this.state.day + 3, "afternoon", "board", {});
    // the board issues NOTES: one active mandate at a time
    if (!this.state.mandates.some((md) => !md.done && !md.failed)) this.issueMandate();
  }

  private issueMandate() {
    const rng = this.rng.get("meetings");
    const d = calDate(this.state.day);
    const kind = rng.pick(["releaseSeason", "beatRival", "releaseCount"] as const);
    let mandate: Mandate;
    if (kind === "releaseSeason") {
      const season = (d.season + 1) % 4;
      const targetYearStart = season > d.season ? (d.year - 1) * 336 : d.year * 336;
      const deadline = targetYearStart + (season + 1) * 12 * DAYS_PER_WEEK;
      mandate = {
        id: this.id("md"),
        kind,
        param: { season, issuedDay: this.state.day },
        deadlineDay: deadline,
        text: `Release a picture in ${SEASONS[season]}. The lot looks idle. Idle looks bad.`,
      };
    } else if (kind === "beatRival") {
      const rivals = this.state.studios.filter((s) => !s.isPlayer && !s.bankrupt);
      const rival = rng.pick(rivals);
      mandate = {
        id: this.id("md"),
        kind,
        param: { rival: rival.name, issuedDay: this.state.day },
        deadlineDay: this.state.day + 12 * DAYS_PER_WEEK,
        text: `Be ahead of ${rival.name} in the standings by quarter's end. The chairman golfs with their chairman.`,
      };
    } else {
      mandate = {
        id: this.id("md"),
        kind: "releaseCount",
        param: { count: 2, issuedDay: this.state.day },
        deadlineDay: this.state.day + 24 * DAYS_PER_WEEK,
        text: `Two releases in the next two quarters. Volume reassures the shareholders. Everything reassures the shareholders except silence.`,
      };
    }
    this.state.mandates.push(mandate);
    const dd = calDate(mandate.deadlineDay);
    this.pushEmail({
      from: "The Board",
      fromRole: "board",
      format: "memo",
      subject: `A note from the board (it is not optional)`,
      body: `${this.line("mandate-issued")}\n"${mandate.text}"\nDeadline: WK ${dd.week} YR ${dd.year}. Deliver and the board's affection grows. Don't, and it doesn't.`,
      actions: [],
      ctx: {},
    });
  }

  applyQuarterResult() {
    const E = this.content.economy;
    const st = this.state;
    const q = Math.floor(st.day / (WEEKS_PER_SEASON * DAYS_PER_WEEK));
    const expectation = E.quarterlyExpectationBase * Math.pow(E.quarterlyExpectationGrowth, q);
    const hist = this.player.history;
    const lookback = Math.min(hist.length - 1, WEEKS_PER_SEASON);
    const qProfit = hist.length > 1 ? hist[hist.length - 1].profit - hist[Math.max(0, hist.length - 1 - lookback)].profit : 0;
    if (qProfit >= expectation) st.patience = Math.min(100, st.patience + E.patienceQuarterReward);
    else st.patience -= E.patienceQuarterHit * (qProfit < 0 ? 1.4 : 1);
    st.patienceTier = this.toneTier();
    if (st.patience <= 0) st.gameOver = { kind: "fired", day: st.day };
    return { qProfit, expectation };
  }

  // ---------- standings & news emails ----------
  private standingsEmail() {
    const d = calDate(this.state.day);
    if (d.week === 1 && d.year === 1) return;
    const dlg = this.rng.get("dialogue");
    const reported = (s: Studio) => s.totalRevenue - s.reportedSpend;
    const ranked = [...this.state.studios].sort((a, b) => reported(b) - reported(a));
    const yourRank = ranked.indexOf(this.player) + 1;
    const prev = this.state.flags.prevRank ?? yourRank;
    this.state.flags.prevRank = yourRank;
    const trend = yourRank < prev ? "up" : yourRank > prev ? "down" : "flat";
    const overtaker = trend === "down" ? ranked[yourRank - 2]?.name : undefined;
    // THE CHART: every picture in theaters this week, ranked by weekend gross
    let body = "";
    if (this.state.weekChart.length) {
      body += "THIS WEEK AT THE BOX OFFICE:\n";
      this.state.weekChart.forEach((row, i) => {
        const m = this.movie(row.movieId)!;
        const wk = Math.floor((this.state.day - (m.releaseDay ?? 0)) / DAYS_PER_WEEK);
        body += `${i + 1}. "${m.title}" (${this.state.studios[m.studio].name.split(" ")[0]}${m.studio === 0 ? " — YOU" : ""}) — ${money(row.gross)} wknd · ${money(m.weeklyGross.reduce((a, b) => a + b, 0))} total · wk ${wk + 1}\n`;
      });
      body += "\n";
    } else {
      body += "Nothing in theaters this week. The popcorn goes stale citywide.\n\n";
    }
    body += `${bankLine(dlg, this.content, "trade-observation")}: studio standings, RELEASED-picture profit (nobody sees your books until opening night).\n`;
    ranked.forEach((s, i) => {
      body += `#${i + 1} ${s.name}${s.isPlayer ? " (you)" : ""}${s.bankrupt ? " †defunct" : ""} — ${money(reported(s))}\n`;
    });
    if (overtaker) body += bankLine(dlg, this.content, "overtake-needle", { rival: overtaker });
    this.pushEmail({
      from: `${this.columnists().news} — The Numbers Desk`,
      fromRole: "trade",
      format: "clipping",
      subject: `Week ${d.week} Standings — ${bankLine(dlg, this.content, `standings-quip-${trend}`)}`,
      body,
      actions: [],
      ctx: {},
      embed: { kind: "standings" },
    });
  }

  private newsEmail(kind: "greenlight" | "signing" | "release", ctx: Record<string, any>) {
    const dlg = this.rng.get("dialogue");
    let body = "";
    if (kind === "greenlight") {
      body = `${ctx.rival} ${bankLine(dlg, this.content, "news-verb-greenlight")} "${ctx.title}" (${ctx.genre}), ${ctx.director} attached. ${bankLine(dlg, this.content, "analyst-take")}`;
      if (ctx.salt) body += `\n${bankLine(dlg, this.content, "poached-salt")}`;
    } else if (kind === "release") {
      body = `${ctx.rival} ${bankLine(dlg, this.content, "news-verb-release")} "${ctx.title}" to ${ctx.gross}. ${bankLine(dlg, this.content, `opening-verdict-${ctx.tier}`)}`;
    }
    body += `\n${bankLine(dlg, this.content, "news-closer")}`;
    this.pushEmail({
      from: `${this.columnists().news} — Varietal Trade Daily`,
      fromRole: "trade",
      subject: `${ctx.rival} ${bankLine(dlg, this.content, `news-verb-${kind}`)} — "${ctx.title}"`,
      body: `${body}
— ${this.columnists().news}`,
      actions: [],
      ctx,
      format: "clipping",
    });
  }

  private welcomeEmail() {
    this.pushEmail({
      from: "The Board",
      fromRole: "board",
      subject: "Welcome to the big chair",
      body: `The studio is yours: ${money(this.player.cash)} in the bank, a lot with your name on a parking spot, and a board that believes in you (today).\nWriters will pitch. Take the meetings that smell like money. Release movies. Beat the other studios. Don't call us; we'll email you.\nQuarterly reviews are real. So is the door.`,
      actions: [],
      ctx: {},
    });
  }

  // ---------- email actions (the player's Read & Reply) ----------
  emailAction(emailId: string, actionId: string) {
    const em = this.state.inbox.find((e) => e.id === emailId);
    if (!em || em.actionTaken) return;
    em.actionTaken = actionId;
    em.read = true;
    this.record("email", em.subject, actionId);
    const m = this.movie(em.ctx.movieId);
    const E = this.content.economy.phases;
    if (actionId === "scheduleMeeting") {
      const lead = this.content.game.meetingLeadDays;
      const day = this.state.day + this.rng.get("schedule").int(lead[0], lead[1]);
      this.bookMeeting(day, "morning", "pitch", { writerId: em.ctx.writerId, pitch: em.ctx.pitch });
    } else if (actionId === "ignore") {
      const w = this.person(em.ctx.writerId);
      if (w) w.relationship -= 4;
      // the trades remember what you pass on
      if (em.ctx.pitch) this.recordPass(em.ctx.pitch);
    } else if (actionId.startsWith("assignProducer_") && m) {
      const pid = actionId.slice("assignProducer_".length);
      const producer = this.person(pid);
      if (!producer) return;
      const cost = Math.round(m.minBudget * E.greenlightPreproFactor);
      this.spend(0, cost);
      m.spent += cost;
      m.producerId = pid;
      // packaging session first: YOU assemble the picture (director + leads), then pre-pro rolls
      this.bookMeeting(this.state.day + 1, "morning", "packaging", { movieId: m.id });
    } else if (actionId === "park" && m) {
      m.phase = "development";
    } else if (actionId === "hireProducer") {
      const producer = this.person(em.ctx.producerId);
      if (producer && producer.signedByStudio === undefined) {
        this.spend(0, this.content.economy.producers.hireCost);
        producer.signedByStudio = 0;
        this.notifyParkedMovies(`${producer.name} has joined the studio.`);
      }
    } else if (actionId === "approveProduction" && m) {
      const cost = Math.round(m.budget * E.greenlightProductionFactor);
      this.spend(0, cost);
      m.spent += cost;
      this.startProduction(m, em.ctx.prodDays ?? 40);
    } else if (actionId === "abandon" && m) {
      this.cancelMovie(m);
    } else if (actionId === "expandBudget" && m) {
      this.spend(0, em.ctx.cost);
      m.spent += em.ctx.cost;
      m.budget += em.ctx.cost;
      const wrap = this.state.events.find((e) => e.type === "productionWrap" && e.data.movieId === m.id);
      if (wrap) wrap.day += em.ctx.delay;
      m.phaseEnd += em.ctx.delay;
      const inc = m.incidents.filter((i) => !i.resolution).pop();
      if (inc) inc.resolution = `budget expanded ${money(em.ctx.cost)}, +${em.ctx.delay} days`;
    } else if (actionId === "cancelProject" && m) {
      this.cancelMovie(m);
    } else if (actionId === "divaIndulge" && m) {
      this.spend(0, em.ctx.cost);
      m.spent += em.ctx.cost;
      m.budget += em.ctx.cost;
      const p = this.person(em.ctx.personId);
      if (p) p.relationship += 6;
      m.incidents.push({ day: this.state.day, kind: "divaDemand", text: em.ctx.demand, cost: em.ctx.cost, delay: 0, resolution: "indulged" });
    } else if (actionId === "divaRefuse" && m) {
      const p = this.person(em.ctx.personId);
      if (p) p.relationship -= 10;
      if (this.rng.get("setbacks").chance(0.35)) {
        m.setbackCount++;
        m.quality.performance = Math.max(5, m.quality.performance - 4);
      }
      m.incidents.push({ day: this.state.day, kind: "divaDemand", text: em.ctx.demand, cost: 0, delay: 0, resolution: "refused — morale took the hit" });
    } else if (actionId.startsWith("vfx_") && m) {
      const vfxId = actionId.slice(4);
      m.vfxStudioId = vfxId;
      const vfx = this.state.vfxStudios.find((v) => v.id === vfxId)!;
      const days = Math.max(7, Math.ceil((m.actualVfx ?? m.estVfx) / vfx.maxDailyShots)) + this.content.economy.post.baseDays;
      m.dailyCost = Math.round((m.budget * this.content.economy.production.baseDailyCostFactor * 0.5 + vfx.dailyCost) / 500) * 500;
      m.phaseEnd = this.state.day + days;
      this.addEvent(m.phaseEnd, "afternoon", "outcome", "vfxDone", { movieId: m.id });
    } else if (actionId === "testScreening" && m) {
      const TS = this.content.economy.testScreening;
      this.spend(0, TS.cost);
      m.spent += TS.cost;
      m.testScreened = true;
      const rng = this.rng.get("audience");
      const leaked = rng.chance(TS.leakChance);
      if (leaked) m.hype = Math.max(0, m.hype - TS.leakHypeHit);
      const segLines = this.state.audience.segments.map((seg) => {
        const affinity = seg.hiddenGenres[m.genre] ?? 0.4;
        const noisy = Math.max(0, Math.min(1, affinity + rng.gaussian(0, 0.08)));
        const read = noisy > 0.6 ? "LEANING IN" : noisy > 0.4 ? "curious" : "cold";
        if (seg.genres[m.genre] === "unknown" && !leaked) seg.genres[m.genre] = noisy > 0.6 ? "like" : noisy < 0.35 ? "dislike" : "unknown";
        return `• ${seg.name}: ${read}`;
      });
      this.pushEmail({
        from: "Research Dept (strip mall, two-way mirror)",
        fromRole: "producer",
        subject: `${m.title}: test screening segment report`,
        body: `${segLines.join("\n")}\n${leaked ? "\n⚠ Footage leaked. It's on the internet with a vertical crop. Hype took a hit." : "\nClean room. Nothing leaked. This time."}\nNow — marketing still wants that number:`,
        actions: (this.content.economy.post.marketingTiers as any[]).map((t) => ({ id: `mkt_${t.id}`, label: `${t.label} (${money(t.cost)})` })),
        ctx: { movieId: m.id },
      });
    } else if (actionId === "triage_reshoot" && m) {
      const T = this.content.economy.triage;
      this.spend(0, em.ctx.reshootCost);
      m.spent += em.ctx.reshootCost;
      m.budget += em.ctx.reshootCost;
      m.quality.performance = Math.min(100, m.quality.performance + T.reshootQuality);
      m.quality.polish = Math.min(100, m.quality.polish + T.reshootQuality / 2);
      m.incidents.push({ day: this.state.day, kind: "reshoots", text: "Emergency reshoots ordered after a disastrous screening.", cost: em.ctx.reshootCost, delay: T.reshootDelayDays, resolution: "new screening scheduled" });
      this.addEvent(this.weekday(this.state.day + T.reshootDelayDays), "afternoon", "outcome", "vfxDone", { movieId: m.id });
    } else if (actionId === "triage_recut" && m) {
      this.spend(0, em.ctx.recutCost);
      m.spent += em.ctx.recutCost;
      m.quality.polish = Math.min(100, m.quality.polish + this.content.economy.triage.recutQuality);
      m.screeningScore = Math.min(100, (m.screeningScore ?? 40) + this.content.economy.triage.recutQuality);
      m.incidents.push({ day: this.state.day, kind: "recut", text: "Recut in-house over a long weekend and a great deal of coffee.", cost: em.ctx.recutCost, delay: 0, resolution: "proceeding to marketing" });
      this.marketingEmail(m, "The recut plays tighter. Nobody says 'masterpiece'. Nobody says 'lawsuit'. Progress.", false);
    } else if (actionId === "triage_dump" && m) {
      const tiers = this.content.economy.post.marketingTiers as any[];
      const quiet = tiers[0];
      this.spend(0, quiet.cost);
      m.spent += quiet.cost;
      m.marketing = quiet.cost;
      m.hype = Math.round(m.hype / 2);
      m.incidents.push({ day: this.state.day, kind: "dumped", text: "Quietly scheduled for a dead-of-winter release. If a movie flops and nobody markets it, does it make a sound?", cost: quiet.cost, delay: 0, resolution: "January it is" });
      const relDay = this.weekday(this.state.day + 35);
      this.addEvent(relDay, "morning", "outcome", "release", { movieId: m.id, marketingTier: quiet.id });
      m.announcedRelease = relDay;
    } else if (actionId === "triage_sell" && m) {
      const buyers = this.state.studios.map((s, i) => i).filter((i) => i !== 0 && !this.state.studios[i].bankrupt);
      const buyer = buyers.length ? this.rng.get("rivals").pick(buyers) : undefined;
      this.earn(0, em.ctx.sellPrice);
      if (buyer !== undefined) {
        m.studio = buyer;
        this.addEvent(this.state.day + 28, "morning", "outcome", "release", { movieId: m.id, marketingTier: "standard" });
        this.pushEmail({
          from: "Business Affairs",
          fromRole: "distribution",
          subject: `${m.title}: sold to ${this.state.studios[buyer].name} (${money(em.ctx.sellPrice)})`,
          body: `Papers signed, tape shipped, ${money(em.ctx.sellPrice)} wired. If it somehow becomes a hit over there, we never speak of this.`,
          actions: [],
          ctx: { movieId: m.id },
        });
      } else {
        m.phase = "cancelled";
      }
    } else if (actionId === "triage_push" && m) {
      this.marketingEmail(m, "Full speed ahead. Sometimes the audience disagrees with the cards. Sometimes.", false);
    } else if (actionId.startsWith("mkt_") && m) {
      const tierId = actionId.slice(4);
      const tier = (this.content.economy.post.marketingTiers as any[]).find((t) => t.id === tierId)!;
      this.spend(0, tier.cost);
      m.spent += tier.cost;
      m.marketing = tier.cost;
      m.hype = Math.min(100, m.hype + tier.reach * 40);
      // release date options: 3 upcoming weekends across seasons
      const opts = this.releaseDateOptions();
      this.pushEmail({
        from: "Distribution Desk",
        fromRole: "distribution",
        subject: `${m.title}: pick a release date`,
        body: `Campaign's rolling. Release windows on the table:\n${opts
          .map((o) => `• ${o.label}`)
          .join("\n")}\nCrowded weekends split the take. Seasons matter. Choose wisely, or at least confidently.`,
        actions: opts.map((o) => ({ id: `rel_${o.day}`, label: o.label })),
        ctx: { movieId: m.id, marketingTier: tierId },
      });
    } else if (actionId.startsWith("rel_") && m) {
      const day = parseInt(actionId.slice(4), 10);
      this.addEvent(day, "morning", "outcome", "release", { movieId: m.id, marketingTier: em.ctx.marketingTier });
      m.announcedRelease = day;
      this.maybeRivalFlinch(m, day);
    } else if (actionId.startsWith("dist_") && m) {
      this.scheduleHomeVideo(m, actionId.slice(5));
    }
  }

  private releaseDateOptions(): { day: number; label: string }[] {
    const base = this.state.day + 21;
    const opts: { day: number; label: string }[] = [];
    const candidates = [base + 7, base + 28, base + 63].map((d) => d - (d % DAYS_PER_WEEK) + 4); // Fridays
    for (const day of candidates) {
      const d = calDate(day);
      // the corridor is public: name who's parked near each window
      const nearby = this.state.movies.filter(
        (o) => o.announcedRelease !== undefined && o.releaseDay === undefined && Math.abs(o.announcedRelease - day) < 14
      );
      const inRelease = this.state.movies.filter((o) => o.releaseDay !== undefined && Math.abs((o.releaseDay ?? 0) - day) < 14 && o.phase === "release");
      const names = [...nearby, ...inRelease].slice(0, 2).map((o) => `${o.title}${o.studio !== 0 ? ` (${this.state.studios[o.studio].name.split(" ")[0]})` : ""}`);
      opts.push({
        day,
        label: `WK ${d.week} ${SEASONS[d.season]} YR ${d.year}${names.length ? ` — vs ${names.join(", ")}` : " — clear weekend"}`,
      });
    }
    return opts;
  }

  /** Announcing into a rival's window can make them blink — the trades love it when they do. */
  private maybeRivalFlinch(m: Movie, day: number) {
    const C = this.content.economy.corridor;
    const rng = this.rng.get("rivals");
    for (const o of this.state.movies) {
      if (o.studio === 0 || o.releaseDay !== undefined || o.announcedRelease === undefined) continue;
      if (Math.abs(o.announcedRelease - day) <= C.collisionWindow && rng.chance(C.flinchChance)) {
        const relEv = this.state.events.find((e) => e.type === "release" && e.data.movieId === o.id);
        if (!relEv) continue;
        relEv.day += C.flinchDays;
        o.announcedRelease = relEv.day;
        const rd = calDate(relEv.day);
        this.pushEmail({
          from: "Varietal Trade Daily",
          fromRole: "trade",
          subject: `${this.state.studios[o.studio].name} BLINKS — "${o.title}" retreats to WK ${rd.week}`,
          body: `Faced with "${m.title}" on the same weekend, ${this.state.studios[o.studio].name} moved "${o.title}" ${C.flinchDays} days downfield. The town noticed. The town always notices.`,
          actions: [],
          ctx: { movieId: o.id },
        });
      }
    }
  }

  /** When producer capacity opens up, resurface parked development movies with assignment actions. */
  notifyParkedMovies(reason: string) {
    const parked = this.state.movies.filter((m) => m.studio === 0 && m.phase === "development");
    if (!parked.length) return;
    for (const m of parked) this.scriptPackageEmail(m);
    this.pushEmail({
      from: "Development Office",
      fromRole: "producer",
      subject: `Development shelf: ${parked.length} project${parked.length > 1 ? "s" : ""} waiting`,
      body: `${reason}\nWaiting for a producer: ${parked.map((m) => m.title).join(", ")}. Fresh assignment memos are in your inbox.`,
      actions: [],
      ctx: {},
    });
  }

  outcome_producerOffer(_ev: SimEvent) {
    const candidates = this.state.people.filter((p) => p.role === "producer" && p.signedByStudio === undefined);
    if (candidates.length) {
      const p = this.rng.get("people").pick(candidates);
      const P = this.content.economy.producers;
      this.pushEmail({
        from: `${p.name} (via headhunter)`,
        fromRole: "producer",
        subject: `Producer available: ${p.name}`,
        body: `${p.name} (${p.archetype.replace(/-/g, "-")}) is taking meetings. Track record: timelines ×${(p.avgProdLength ?? 1).toFixed(2)}, costs ×${(p.avgProdCost ?? 1).toFixed(2)}, revenue ×${(p.avgProdRevenue ?? 1).toFixed(2)}, craft ${p.avgRating}/100.\nSigning fee: ${money(P.hireCost)}. More producers = more movies you can actually run at once.`,
        actions: [
          { id: "hireProducer", label: `Hire ${p.name} (${money(P.hireCost)})` },
          { id: "ignore", label: "Pass" },
        ],
        ctx: { producerId: p.id },
      });
    }
    const iv = this.content.economy.producers.hireOfferIntervalDays;
    this.addEvent(this.weekday(this.state.day + this.rng.get("schedule").int(iv[0], iv[1])), "morning", "outcome", "producerOffer", {});
  }

  private cancelMovie(m: Movie) {
    m.phase = "cancelled";
    if (m.studio === 0) {
      this.rep("loyalty", -3);
      for (const pr of this.state.promises!.filter((x) => x.movieId === m.id && !x.honored && !x.broken)) {
        this.breakPromise(pr, `"${m.title}" was shut down with their deal attached`);
      }
    }
    for (const cid of [...m.castIds, m.directorId].filter(Boolean) as string[]) {
      const p = this.person(cid)!;
      p.busyUntil = this.state.day;
      p.signedByStudio = undefined;
      p.relationship -= 8;
    }
    for (const ev of this.state.events.filter((e) => e.data.movieId === m.id)) {
      this.state.events = this.state.events.filter((e) => e !== ev);
    }
    if (m.studio === 0 && m.producerId) this.notifyParkedMovies(`${this.person(m.producerId)?.name ?? "A producer"} is free after ${m.title} was shut down.`);
  }

  // ---------- player phase starters ----------
  startScript(m: Movie, writer: Person) {
    // sequel options collect the moment the sequel is real
    if (m.sequelOf) {
      for (const pr of this.state.promises!.filter((x) => x.kind === "sequel" && x.movieId === m.sequelOf && !x.honored && !x.broken)) {
        const talent = this.person(pr.personId);
        if (talent && talent.busyUntil <= this.state.day) {
          m.idealCastIds = [talent.id, ...m.idealCastIds.filter((c) => c !== talent.id)].slice(0, 2);
          this.honorPromise(pr, `their sequel option on the franchise`);
        } else if (talent) {
          this.breakPromise(pr, `the sequel went ahead while they were unavailable`);
        }
      }
    }
    const E = this.content.economy.phases;
    const cost = Math.round(m.minBudget * E.greenlightScriptFactor);
    this.spend(0, cost);
    m.spent += cost;
    m.phase = "script";
    m.phaseStart = this.state.day;
    const rng = this.rng.get("schedule");
    const days = rng.int(E.scriptDays[0], E.scriptDays[1]);
    m.phaseEnd = this.state.day + days;
    this.addEvent(m.phaseEnd, "morning", "outcome", "scriptDone", { movieId: m.id });
    writer.relationship += 10;
    writer.busyUntil = m.phaseEnd;
  }

  startPrepro(m: Movie) {
    const E = this.content.economy.phases;
    m.phase = "prepro";
    m.phaseStart = this.state.day;
    // pre-production is not free: scouts, storyboards, and a lot of lunches
    m.dailyCost = Math.max(2000, Math.round((m.minBudget * (this.content.economy.prepro?.dailyCostFactor ?? 0.001)) / 500) * 500);
    const rng = this.rng.get("schedule");
    const overload = this.overloadFactor(m.producerId);
    const days = Math.round(rng.int(E.preproDays[0], E.preproDays[1]) * overload);
    // casting interviews for ideal cast that's free — pre-production cannot wrap before casting resolves
    let slotDay = this.state.day + 2;
    let lastCastingDay = this.state.day;
    for (const cid of m.idealCastIds) {
      const c = this.person(cid);
      if (!c) continue;
      this.state.flags[`playerWanted_${cid}`] = true;
      if (c.busyUntil > this.state.day) continue; // already signed away — scarcity bites
      const ev = this.bookMeeting(slotDay, "afternoon", "casting", { movieId: m.id, castId: cid });
      lastCastingDay = Math.max(lastCastingDay, ev.day);
      slotDay = ev.day + 2;
    }
    // attach director: ideal if free, else best free
    const ideal = this.person(m.directorId);
    if (!ideal) {
      const wantId = (m as any).idealDirectorId ?? undefined;
      const want = this.person(wantId);
      const freeDirectors = this.state.people.filter((p) => p.role === "director" && p.busyUntil <= this.state.day);
      const pick = want && want.busyUntil <= this.state.day ? want : freeDirectors[0];
      if (pick) {
        m.directorId = pick.id;
        pick.busyUntil = this.state.day + 200;
        pick.signedByStudio = 0;
      }
    }
    m.phaseEnd = Math.max(this.state.day + days, lastCastingDay + 3);
    this.addEvent(m.phaseEnd, "morning", "outcome", "preproDone", { movieId: m.id });
  }

  startProduction(m: Movie, prodDays: number) {
    m.phase = "production";
    m.phaseStart = this.state.day;
    m.phaseEnd = this.state.day + prodDays;
    for (const cid of [...m.castIds, m.directorId].filter(Boolean) as string[]) {
      const p = this.person(cid)!;
      p.busyUntil = m.phaseEnd + 30;
      p.signedByStudio = 0;
    }
    this.addEvent(m.phaseEnd, "afternoon", "outcome", "productionWrap", { movieId: m.id });
    // mid-production review meeting
    this.bookMeeting(this.state.day + Math.floor(prodDays / 2), "morning", "productionReview", { movieId: m.id });
  }

  private scheduleStandups() {
    const d = calDate(this.state.day);
    const tier = this.toneTier();
    // exec standup frequency escalates with lost patience: quarterly / monthly / biweekly / weekly
    const execEvery = [12, 4, 2, 1][tier];
    if ((d.week - 2) % execEvery === 0 && !this.state.events.some((e) => e.type === "execStandup" && e.day <= this.state.day + 7)) {
      this.bookMeeting(this.state.day + 4, "morning", "execStandup", {});
    }
    // producers standup WEEKLY whenever any producer has an active project
    const inFlight = this.state.movies.some((m) => m.studio === 0 && ["prepro", "production", "post"].includes(m.phase));
    if (inFlight && !this.state.events.some((e) => e.type === "producersStandup" && e.day <= this.state.day + 7)) {
      this.bookMeeting(this.state.day + 1, "morning", "producersStandup", {});
    }
  }

  // ---------- annual events ----------
  scheduleAnnualEvents() {
    const E = this.content.economy;
    const d = calDate(this.state.day);
    const yearStart = (d.year - 1) * 336;
    const conDay = this.weekday(yearStart + (E.convention.week - 1) * DAYS_PER_WEEK + 3);
    const awardsDay = this.weekday(yearStart + (E.awards.week - 1) * DAYS_PER_WEEK + 3);
    if (conDay > this.state.day && !this.state.events.some((e) => e.type === "convention" && e.day === conDay))
      this.addEvent(conDay, "afternoon", "meeting", "convention", {});
    if (awardsDay > this.state.day && !this.state.events.some((e) => e.type === "awards" && e.day === awardsDay))
      this.addEvent(awardsDay, "evening", "meeting", "awards", {});
    const festDay = this.weekday(yearStart + (E.festival.week - 1) * DAYS_PER_WEEK + 3);
    if (festDay > this.state.day && !this.state.events.some((e) => e.type === "festival" && e.day === festDay))
      this.addEvent(festDay, "afternoon", "meeting", "festival", {});
  }

  /** Take someone to lunch — relationships as something you PLAY, not a side effect. */
  requestLunch(personId: string): boolean {
    const p = this.person(personId);
    if (!p || this.state.events.some((e) => e.type === "lunch" && e.data.personId === personId)) return false;
    this.bookMeeting(this.state.day + this.rng.get("schedule").int(1, 3), "morning", "lunch", { personId });
    return true;
  }

  /** Send the star out to sell it. Costs money and their goodwill; buys hype. */
  pressTour(movieId: string): string {
    const m = this.movie(movieId);
    const P = this.content.economy.pressTour;
    if (!m || !["post", "release"].includes(m.phase)) return "not in the window";
    if (m.pressTours >= P.maxPerMovie) return "the star has been on every couch already";
    if (this.player.cash < P.cost) return "can't afford it";
    const star = this.person(m.castIds[0]);
    this.spend(0, P.cost);
    m.spent += P.cost;
    m.pressTours++;
    m.hype = Math.min(100, m.hype + P.hype);
    if (star) star.relationship -= P.relationshipHit;
    this.record("pressTour", m.title, String(m.pressTours));
    return `${star?.name ?? "The cast"} hits the circuit. Hype +${P.hype}${star ? `, ${star.name.split(" ")[0]}'s patience −${P.relationshipHit}` : ""}.`;
  }
}
