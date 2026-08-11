// Dialogue encounters. The player picks lines; the counterpart decides.
// Each meeting is a tiny state machine over content-defined beats.

import type { Sim } from "./sim";
import type { Intel, Movie, Person, SimEvent } from "./types";
import { bankLine, fill, money } from "./text";
import { callbackLine, remember, mintVoice, voiceLine } from "./voice";
import { calDate, SEASONS, DAYS_PER_WEEK } from "./types";

export interface Choice {
  id: string;
  line: string;
  gated?: string; // unmet requirement — rendered greyed with this label (M&B style)
}

export interface Beat {
  speaker: string;
  portraitId?: string; // person id for portrait, or role tag
  text: string;
  choices?: Choice[];
  done?: boolean;
  tell?: string; // body-language read of where you stand
  rapport?: number; // 0-100, surfaced as the needle
  memoryNote?: string; // "Marlowe will remember that"
  pressure?: boolean; // timed-choice eligible (surface honors the toggle)
  sentiment?: "happy" | "neutral" | "grumpy";
}

export class MeetingSession {
  stage = 0;
  data: Record<string, any> = {};
  constructor(public sim: Sim, public event: SimEvent) {}

  get content() {
    return this.sim.content;
  }
  get M() {
    return this.content.meetings[this.event.type as keyof typeof this.content.meetings] as any;
  }
  dlg() {
    return this.sim.rng.get("dialogue");
  }

  start(): Beat {
    const fn = (this as any)[`start_${this.event.type}`];
    return fn.call(this);
  }
  choose(choiceId: string): Beat {
    this.sim.record("meeting", this.event.type, choiceId);
    // interruption resume: whatever they chose about the phone, then back to the room
    if (this.data.interruptedNext) return this.handleInterruption(choiceId);
    const fn = (this as any)[`choose_${this.event.type}`];
    return fn.call(this, choiceId);
  }

  // ============ GSBT engine: Greeting → Schmooze → Business → Terms ============
  // Rapport is the meeting's currency. The greeting sets it, schmoozing gambles it,
  // business spends it. Their personality (archetype matrix) decides what works.

  get G() {
    return this.content.meetings.gsbt as any;
  }

  private rapportBand(): "high" | "mid" | "low" {
    return this.data.rapport > 60 ? "high" : this.data.rapport > 35 ? "mid" : "low";
  }

  tell(): string {
    const tells = this.content.voices.tells[this.rapportBand()] as string[];
    return this.dlg().pick(tells);
  }

  private moveRapport(delta: number) {
    this.data.rapport = Math.max(5, Math.min(95, this.data.rapport + delta));
  }

  /** Greeting beat: their arrival telegraphs their mood — reading it right is the first move. */
  greetingBeat(person: Person, intro: string): Beat {
    const rng = this.sim.rng.get("meetings");
    const mems = person.memories ?? [];
    const memBias = mems.length ? Math.sign(mems[mems.length - 1].delta) * 1 : 0;
    const moodScore = person.relationship / 25 + memBias + rng.gaussian(0, 1);
    const mood = moodScore > 2 ? "great" : moodScore > 0.7 ? "good" : moodScore > -0.7 ? "neutral" : moodScore > -2 ? "bad" : "awful";
    this.data.mood = mood;
    this.data.rapport = 45 + person.relationship / 5 + (mood === "great" ? 10 : mood === "good" ? 5 : mood === "bad" ? -8 : mood === "awful" ? -15 : 0);
    this.data.phase = "greeting";
    this.data.schmoozeRounds = 0;
    const arrival = this.dlg().pick(this.content.voices.greetingMoods[mood] as string[]);
    const callback = callbackLine(person, this.sim.state.day, this.dlg());
    return {
      speaker: person.name,
      portraitId: person.id,
      text: `${person.name} ${arrival}.${callback ? `\n"${callback}"` : ""}\n${intro}`,
      tell: this.tell(),
      rapport: this.data.rapport,
      choices: (this.G.greetingResponses as any[]).map((g) => ({ id: g.id, line: g.line })),
    };
  }

  handleGreeting(choiceId: string, person: Person): Beat {
    const mood = this.data.mood;
    if (choiceId === "greet_match") {
      this.moveRapport(5); // reading the room always plays
    } else if (choiceId === "greet_warm") {
      // a big welcome lands on a good day and grates on a bad one
      this.moveRapport(mood === "great" || mood === "good" ? 8 : mood === "neutral" ? 3 : -5);
    } else {
      this.moveRapport(-2); // brisk, but they respect the clock
      this.data.phase = "business";
      return this.data.businessFactory();
    }
    this.data.phase = "schmooze";
    return this.schmoozeBeat(person);
  }

  schmoozeBeat(person: Person): Beat {
    const rounds = this.data.schmoozeRounds;
    const intel = this.sim.freshIntel();
    const choices: Choice[] = [];
    if (rounds < 3) {
      for (const s of this.G.schmooze as any[]) {
        if (s.id === "toBusiness") continue;
        if (s.requires === "intel") {
          if (intel.length) choices.push({ id: s.id, line: `${s.line} (spend: "${intel[0].text.slice(0, 44)}…")` });
          else choices.push({ id: s.id, line: s.line, gated: "Requires intel — take a lunch, read the trades" });
        } else choices.push({ id: s.id, line: s.line });
      }
    }
    choices.push({ id: "toBusiness", line: rounds > 0 ? "Enough charm. Down to business." : "Down to business." });
    return {
      speaker: person.name,
      portraitId: person.id,
      text:
        rounds === 0
          ? `Small talk unfurls — the weather, the trades, who got fired at ${this.sim.state.studios.find((s) => !s.isPlayer && !s.bankrupt)?.name ?? "the other place"}. A window for charm, if you want it.`
          : rounds >= 2
          ? `The pleasantries are wearing a groove. ${this.dlg().pick(this.G.overSchmooze as string[])}`
          : `They're warmed up. One more move, or get to it.`,
      tell: this.tell(),
      rapport: this.data.rapport,
      choices,
    };
  }

  handleSchmooze(choiceId: string, person: Person): Beat {
    const rng = this.sim.rng.get("meetings");
    if (choiceId === "toBusiness") {
      this.data.phase = "business";
      // small interruption chance right as things get serious — the town never waits
      if (!this.data.interruptedUsed && rng.chance(0.08)) return this.interruptionBeat(person);
      return this.data.businessFactory();
    }
    this.data.schmoozeRounds++;
    const matrix = (this.G.schmoozeMatrix[person.archetype] ?? this.G.schmoozeMatrix.default) as Record<string, number>;
    const affinity = matrix[choiceId] ?? 3;
    const hitChance = Math.max(0.15, 0.78 - this.data.schmoozeRounds * 0.18 + affinity / 50);
    let text: string;
    let delta: number;
    if (choiceId === "sch_gossip") {
      const intel = this.sim.freshIntel()[0];
      if (!intel) return this.schmoozeBeat(person);
      intel.used = true;
      if (!intel.reliable && rng.chance(0.5)) {
        delta = -10;
        text = `You lean in with it. A pause. "…That's not true. My cousin was THERE." The gossip columnist strikes again.`;
      } else {
        delta = affinity + 4;
        text = this.dlg().pick(this.G.gossipHits as string[]);
      }
    } else if (rng.chance(hitChance)) {
      delta = affinity;
      text = this.dlg().pick((choiceId === "sch_flatter" ? this.G.flatterHits : this.G.jokeHits) as string[]);
    } else {
      delta = -6;
      text = this.dlg().pick((choiceId === "sch_flatter" ? this.G.flatterMisses : this.G.jokeMisses) as string[]);
    }
    this.moveRapport(delta);
    const beat = this.schmoozeBeat(person);
    beat.text = `${text}\n\n${beat.text}`;
    beat.sentiment = delta > 0 ? "happy" : "grumpy";
    if (Math.abs(delta) >= 8) {
      remember(person, this.sim.state.day, delta > 0 ? "you charmed them properly in the room" : "you embarrassed yourself schmoozing them", delta);
      beat.memoryNote = `${person.name.split(" ")[0]} will remember that.`;
    }
    return beat;
  }

  private interruptionBeat(person: Person): Beat {
    this.data.interruptedUsed = true;
    const rng = this.sim.rng.get("meetings");
    const topic = rng.pick(this.G.interruptTopics as string[]);
    const text = fill(rng.pick(this.G.interruptions as string[]), { topic });
    this.data.interruptedNext = person.id;
    return {
      speaker: "Interruption",
      portraitId: person.id,
      text: `${text}\n${person.name} watches you decide what matters more.`,
      rapport: this.data.rapport,
      pressure: true,
      choices: [
        { id: "phone_take", line: "Take it. Two minutes. (They'll mind.)" },
        { id: "phone_ignore", line: "Flip the phone face-down. All eyes here." },
      ],
    };
  }

  private handleInterruption(choiceId: string): Beat {
    const person = this.sim.person(this.data.interruptedNext)!;
    this.data.interruptedNext = undefined;
    if (choiceId === "phone_take") {
      this.moveRapport(-7);
      const saved = Math.round(200000 + this.sim.rng.get("meetings").next() * 500000);
      this.sim.earn(0, saved);
      const beat = this.data.businessFactory() as Beat;
      beat.text = `Two minutes becomes four. You solve it — ${money(saved)} not lost to chaos.\n${person.name} has been studying the art on your wall.\n\n${beat.text}`;
      beat.rapport = this.data.rapport;
      return beat;
    }
    this.moveRapport(6);
    remember(person, this.sim.state.day, "you turned your phone over for them", 6);
    const beat = this.data.businessFactory() as Beat;
    beat.text = `The phone buzzes itself out. ${person.name} clocks it — everyone always does.\n\n${beat.text}`;
    beat.memoryNote = `${person.name.split(" ")[0]} will remember that.`;
    beat.rapport = this.data.rapport;
    return beat;
  }

  // ---------- pitch ----------
  // Full GSBT: greeting reads their mood, schmoozing banks rapport, probes buy information,
  // and the final decision weighs everything you built (or torched) in the room.
  start_pitch(): Beat {
    const writer = this.sim.person(this.event.data.writerId)!;
    const p = this.event.data.pitch;
    this.data.writer = writer;
    this.data.asked = [] as string[];
    this.data.businessFactory = () => this.pitchBusinessBeat();
    return this.greetingBeat(
      writer,
      `A one-sheet slides across the table: "${p.title}" — ${p.genre}/${p.subgenre}, ${p.estRating}. ${p.logline}. Cost to greenlight a script: ${money(
        p.minBudget * this.content.economy.phases.greenlightScriptFactor
      )}.`
    );
  }

  private pitchBusinessBeat(): Beat {
    const writer: Person = this.data.writer;
    return {
      speaker: writer.name,
      portraitId: writer.id,
      text: voiceLine(this.content, writer, `"So. ${this.data.rapport > 60 ? "I want this to be a yes. Make it easy for me." : "What do you want to know?"}"`, this.dlg()),
      tell: this.tell(),
      rapport: this.data.rapport,
      choices: this.pitchChoices(),
    };
  }

  private pitchChoices() {
    return [
      ...(this.M.probes as any[]).filter((pr) => !this.data.asked.includes(pr.id)).map((pr) => ({ id: `probe_${pr.id}`, line: pr.line })),
      ...(this.M.positions as any[]).map((po) => ({ id: `pos_${po.id}`, line: po.line })),
    ];
  }

  choose_pitch(choiceId: string): Beat {
    const writer: Person = this.data.writer;
    const p = this.event.data.pitch;
    const rng = this.sim.rng.get("meetings");
    if (this.data.phase === "greeting") return this.handleGreeting(choiceId, writer);
    if (this.data.phase === "schmooze") return this.handleSchmooze(choiceId, writer);
    if (choiceId.startsWith("probe_")) {
      const probe = (this.M.probes as any[]).find((x) => `probe_${x.id}` === choiceId)!;
      this.data.asked.push(probe.id);
      this.moveRapport(this.data.asked.length <= 2 ? 2 : -6); // they like being asked — up to a point
      let reveal = "";
      if (probe.reveals === "idealDirector") {
        const d = this.sim.person(p.idealDirectorId);
        reveal = d
          ? `"${d.name}. ${d.archetype.replace(/-/g, " ")}. Averages ${d.avgVfxShots} VFX shots and ${d.avgReshoots} reshoots — you do the math on the budget."`
          : `"Honestly? Whoever answers the phone."`;
      } else if (probe.reveals === "fadStatus") {
        const heat = this.sim.state.audience.fads[p.genre] ?? 1;
        const rivalCount = this.sim.state.movies.filter((m) => m.studio !== 0 && m.genre === p.genre && ["production", "post", "prepro"].includes(m.phase)).length;
        reveal = heat > 1.2 ? `"${p.genre} is scorching. ${rivalCount ? `${rivalCount} rival production${rivalCount > 1 ? "s" : ""} already shooting one — speed matters.` : "And somehow nobody's shooting one yet. Window's open."}"` : heat < 0.8 ? `"${p.genre}'s cold, which means the field is EMPTY. Contrarian money."` : `"${p.genre}'s steady. No fad, no saturation. Boring, dependable money."`;
      } else if (probe.reveals === "revenue") {
        reveal = `"Comparable pictures do ${money(this.sim.estimateRevenue(p.minBudget, p.genre))} against a ${money(p.minBudget)} budget. Conservatively. I'm being conservative."`;
      } else if (probe.reveals === "timeline") {
        const d = this.sim.person(p.idealDirectorId);
        const weeks = Math.round(((d?.avgLocations ?? 5) * this.content.economy.production.baseDaysPerLocation + this.content.economy.post.baseDays + 60) / 7);
        reveal = `"Script to screen? ${weeks} weeks if nothing goes wrong. Something always goes wrong, so call it ${weeks + 6}."`;
      } else {
        reveal = `"${p.logline}. But underneath? It's about my divorce."`;
      }
      return {
        speaker: writer.name,
        portraitId: writer.id,
        text: voiceLine(this.content, writer, reveal, this.dlg()),
        tell: this.tell(),
        rapport: this.data.rapport,
        choices: this.pitchChoices(),
      };
    }
    const pos = (this.M.positions as any[]).find((x) => `pos_${x.id}` === choiceId)!;
    writer.relationship += pos.writerMood;
    if (pos.id === "greenlight" || pos.id === "cheap") {
      // their decision weighs the offer, the relationship, and the room you built
      const base = pos.id === "greenlight" ? 0.85 : 0.42;
      const odds = base + writer.relationship / 200 + (this.data.rapport - 50) / 110 + (writer.archetype === "pulp-factory" ? 0.1 : 0);
      const accepted = rng.chance(Math.max(0.08, Math.min(0.97, odds)));
      if (accepted) {
        if (pos.id === "cheap") this.sim.rep("paysWell", -2);
        else this.sim.rep("paysWell", 1);
        const m = this.sim.createMovie(0, writer, p);
        (m as any).idealDirectorId = p.idealDirectorId;
        this.sim.startScript(m, writer);
        remember(writer, this.sim.state.day, `you greenlit "${p.title}" in the room`, 8);
        return {
          speaker: writer.name,
          portraitId: writer.id,
          text: fill(this.dlg().pick(this.M.reactions.accept as string[]), { writer: writer.name }),
          sentiment: "happy",
          memoryNote: `${writer.name.split(" ")[0]} will remember this room fondly.`,
          done: true,
        };
      }
      writer.relationship -= 6;
      remember(writer, this.sim.state.day, `you couldn't close on "${p.title}"`, -6);
      this.sim.recordPass(p);
      return {
        speaker: writer.name,
        portraitId: writer.id,
        text: `${fill(this.dlg().pick(this.M.reactions.walk as string[]), { writer: writer.name })}\n(The room went cold before the offer landed.)`,
        sentiment: "grumpy",
        memoryNote: `${writer.name.split(" ")[0]} will remember that.`,
        done: true,
      };
    }
    // pass
    this.sim.recordPass(p);
    return {
      speaker: writer.name,
      portraitId: writer.id,
      text: fill(this.dlg().pick(this.M.reactions.walk as string[]), { writer: writer.name }),
      sentiment: "grumpy",
      done: true,
    };
  }

  // ---------- casting ----------
  // GSBT + a TERMS phase: the deal isn't done at "yes" — clauses (backend, sequel options,
  // script approval) are real promises the game collects on later.
  start_casting(): Beat {
    const cast = this.sim.person(this.event.data.castId)!;
    const movie = this.sim.movie(this.event.data.movieId)!;
    this.data.cast = cast;
    this.data.movie = movie;
    const flop = cast.filmography.filter((f) => f.profit < 0).sort((a, b) => b.stars - a.stars)[0];
    this.data.flatterTitle = flop?.title ?? cast.filmography[0]?.title ?? "that thing you did";
    this.data.businessFactory = () => this.castingAskBeat();
    return this.greetingBeat(cast, `The part: the lead in "${movie.title}". Their rate card says ${money(cast.dailyRate ?? 0)}/day. Their rider says "${cast.rider}".`);
  }

  private castingAskBeat(): Beat {
    const cast: Person = this.data.cast;
    const ask = this.dlg().pick(this.M.asks as string[]);
    const intel = this.sim.freshIntel(cast.id);
    const anyIntel = this.sim.freshIntel().filter((i) => i.kind === "availability" || i.subjectId === cast.id);
    const choices: Choice[] = (this.M.plays as any[]).map((pl) => ({ id: pl.id, line: fill(pl.line, { flatterTitle: this.data.flatterTitle }) }));
    // leverage: knowing their situation changes the table
    if (anyIntel.length) {
      choices.push({ id: "leverage", line: `Mention what you heard — "${anyIntel[0].text.slice(0, 48)}…" — and hold your number.` });
    } else {
      choices.push({ id: "leverage", line: "Play hardball with what you know about their situation.", gated: "Requires intel about them — lunches and trades" });
    }
    return {
      speaker: cast.name,
      portraitId: cast.id,
      text: voiceLine(this.content, cast, `"${ask}"`, this.dlg()),
      tell: this.tell(),
      rapport: this.data.rapport,
      pressure: true,
      choices,
    };
  }

  choose_casting(choiceId: string): Beat {
    const cast: Person = this.data.cast;
    const movie: Movie = this.data.movie;
    const rng = this.sim.rng.get("meetings");
    // stage 1: the agent's package rider
    if (this.stage === 1) {
      const extra: Person | undefined = this.data.packageExtra;
      const agent = this.sim.person(cast.agentId);
      if (choiceId === "pkg_accept" && extra) {
        movie.castIds.push(extra.id);
        extra.busyUntil = this.sim.state.day + 150;
        extra.signedByStudio = 0;
        const disc = this.sim.content.economy.agents.packageDiscount;
        const rateCost = Math.round((extra.dailyRate ?? 15000) * disc * 30);
        movie.budget += rateCost;
        return { speaker: agent?.name ?? "The Agent", portraitId: agent?.id, text: `"Wonderful. Two for the price of one point eight." ${extra.name} joins the picture. The gift basket had a person in it.`, done: true };
      }
      return { speaker: agent?.name ?? "The Agent", portraitId: agent?.id, text: `"No package? Fine. Remembered, but fine." The call ends with expensive politeness.`, done: true };
    }
    if (this.data.phase === "greeting") return this.handleGreeting(choiceId, cast);
    if (this.data.phase === "schmooze") return this.handleSchmooze(choiceId, cast);
    if (this.data.phase === "terms") return this.castingTerms(choiceId);

    // ---- business: the offer. Rapport bends every roll. ----
    const rapportEdge = (this.data.rapport - 50) / 160;
    let key: keyof typeof this.M.reactions = "accept";
    let signed = true;
    let rateMult = 1;
    if (choiceId === "meet") {
      key = "accept";
      cast.relationship += 8;
      this.sim.rep("paysWell", 2);
    } else if (choiceId === "counterLow") {
      rateMult = 0.65;
      const odds = 0.35 + (cast.cooperation ?? 50) / 200 + cast.relationship / 150 + ((cast.fame ?? 50) < 40 ? 0.2 : 0) + rapportEdge + (this.sim.state.reputation!.paysWell > 60 ? 0.08 : 0);
      if (rng.chance(Math.max(0.1, Math.min(0.88, odds)))) {
        key = "acceptGrudge";
        cast.relationship -= 5;
        this.sim.rep("paysWell", -2);
      } else {
        signed = false;
        key = "walk";
        cast.relationship -= 10;
      }
    } else if (choiceId === "backend") {
      rateMult = 0.4;
      const odds = 0.3 + (cast.improv ?? 50) / 180 + cast.relationship / 120 + rapportEdge;
      if (rng.chance(Math.max(0.1, Math.min(0.85, odds)))) {
        key = "accept";
        this.sim.state.flags[`backend_${movie.id}_${cast.id}`] = true;
        this.sim.addPromise("backend", `${cast.name} gets backend points on "${movie.title}"`, cast.id, movie.id);
      } else {
        signed = false;
        key = "walk";
      }
    } else if (choiceId === "flatter") {
      cast.relationship += 12;
      const odds = 0.55 + cast.relationship / 150 + rapportEdge;
      if (rng.chance(Math.min(0.92, odds))) {
        key = "acceptGrudge";
        rateMult = 0.85;
      } else {
        key = "demand";
        rateMult = 1.1;
      }
      // demand still signs — at a price
    } else if (choiceId === "leverage") {
      const intel = this.sim.freshIntel().filter((i) => i.kind === "availability" || i.subjectId === cast.id)[0];
      if (!intel) return this.castingAskBeat();
      intel.used = true;
      if (!intel.reliable && rng.chance(0.5)) {
        signed = false;
        key = "walk";
        cast.relationship -= 12;
        remember(cast, this.sim.state.day, "you tried to squeeze them with bad information", -12);
      } else {
        rateMult = 0.7;
        key = "acceptGrudge";
        cast.relationship -= 4;
        remember(cast, this.sim.state.day, "you knew exactly how empty their calendar was", -4);
      }
    }
    if (!signed) {
      remember(cast, this.sim.state.day, `negotiations for "${movie.title}" collapsed`, -8);
      return {
        speaker: cast.name,
        portraitId: cast.id,
        text: this.dlg().pick(this.M.reactions.walk as string[]),
        sentiment: "grumpy",
        memoryNote: `${cast.name.split(" ")[0]} will remember that.`,
        done: true,
      };
    }
    // signed in principle — now the paper: TERMS
    this.data.phase = "terms";
    this.data.signedInfo = { rateMult, key };
    return {
      speaker: cast.name,
      portraitId: cast.id,
      text: `${this.dlg().pick(this.M.reactions[key] as string[])}\nTheir agent slides the draft over. "Now — the fine print." How does the contract read?`,
      tell: this.tell(),
      rapport: this.data.rapport,
      choices: [
        { id: "terms_standard", line: "Standard paper. Rate, dates, done." },
        { id: "terms_backend", line: "Sweeten with backend points (rate −30% now; they share the upside — a promise on record)" },
        { id: "terms_sequel", line: "Sequel option (rate −15%; if a sequel happens, they're IN it — a promise on record)" },
        { id: "terms_approval", line: "Grant script approval (they'll love you; the set may not thank you)" },
      ],
    };
  }

  private castingTerms(choiceId: string): Beat {
    const cast: Person = this.data.cast;
    const movie: Movie = this.data.movie;
    const rng = this.sim.rng.get("meetings");
    let { rateMult, key } = this.data.signedInfo as { rateMult: number; key: string };
    let clauseNote = "Standard terms. Clean paper.";
    if (choiceId === "terms_backend") {
      rateMult *= 0.7;
      this.sim.state.flags[`backend_${movie.id}_${cast.id}`] = true;
      this.sim.addPromise("backend", `${cast.name} holds backend points on "${movie.title}"`, cast.id, movie.id);
      clauseNote = "Backend points inked. Cheaper today; the promise collects at the home-video window.";
    } else if (choiceId === "terms_sequel") {
      rateMult *= 0.85;
      this.sim.addPromise("sequel", `${cast.name} has a sequel option on "${movie.title}"`, cast.id, movie.id);
      cast.relationship += 4;
      clauseNote = "Sequel option granted. If this becomes a franchise, they ride with it — or you pay for forgetting.";
    } else if (choiceId === "terms_approval") {
      this.sim.state.flags[`scriptApproval_${movie.id}_${cast.id}`] = true;
      this.sim.addPromise("scriptApproval", `${cast.name} has script approval on "${movie.title}"`, cast.id, movie.id);
      cast.relationship += 8;
      this.moveRapport(8);
      clauseNote = "Script approval granted. They beam. Somewhere, a future draft trembles.";
    }
    // finalize the signing
    movie.castIds.push(cast.id);
    cast.busyUntil = this.sim.state.day + 150;
    cast.signedByStudio = 0;
    const rateCost = Math.round((cast.dailyRate ?? 20000) * rateMult * 30);
    movie.budget += rateCost;
    this.sim.state.flags[`rate_${movie.id}_${cast.id}`] = rateCost;
    remember(cast, this.sim.state.day, `you signed them onto "${movie.title}"${choiceId !== "terms_standard" ? " with real terms" : ""}`, 8);
    // the agent materializes: it's a package, it was always a package
    const A = this.sim.content.economy.agents;
    const agent = this.sim.person(cast.agentId);
    if (agent && rng.chance(A.packageChance)) {
      const stablemate = this.sim.state.people.find(
        (p) => p.role === "cast" && p.agentId === agent.id && p.id !== cast.id && p.busyUntil <= this.sim.state.day && !movie.castIds.includes(p.id)
      );
      if (stablemate) {
        this.stage = 1;
        this.data.packageExtra = stablemate;
        const disc = Math.round((stablemate.dailyRate ?? 15000) * A.packageDiscount * 30);
        return {
          speaker: agent.name,
          portraitId: agent.id,
          text: `${clauseNote}\nYour phone buzzes before the ink dries — it's ${agent.name}, the agent. ${fill(
            this.sim.line("agent-package", { star: cast.name, extra: stablemate.name }),
            {}
          )}\n(${stablemate.name}: coop ${stablemate.cooperation}, improv ${stablemate.improv}, fame ${stablemate.fame} — ${money(disc)} for the run.)`,
          choices: [
            { id: "pkg_accept", line: `Take the package (${money(disc)} — the agent smiles somewhere)` },
            { id: "pkg_decline", line: "Just the one star, thanks." },
          ],
        };
      }
    }
    return {
      speaker: cast.name,
      portraitId: cast.id,
      text: `${this.dlg().pick(this.M.reactions[key as keyof typeof this.M.reactions] as string[])}\n${clauseNote}`,
      sentiment: "happy",
      rapport: this.data.rapport,
      done: true,
    };
  }

  // ---------- board ----------
  start_board(): Beat {
    const tier = this.sim.toneTier();
    const tone = ["warm", "curt", "cold", "hostile"][tier];
    const result = this.sim.applyQuarterResult();
    this.data.result = result;
    const hit = result.qProfit >= result.expectation;
    const open = bankLine(this.dlg(), this.content, `board-open-${tone}`);
    const mandate = this.sim.state.mandates.filter((md) => !md.done && !md.failed).pop();
    const mandateLine = mandate ? `\nStanding note: "${mandate.text}"` : "";
    // a winning quarter gets a winner's script — you're taking a lap, not a deposition
    const choices = hit ? (this.M.victories as any[]) : (this.M.defenses as any[]);
    return {
      speaker: "The Board",
      portraitId: "board",
      text: `${open}\nQuarter: ${money(result.qProfit)} against an expectation of ${money(result.expectation)}. ${hit ? "The chairman almost smiled." : "Explain."}${mandateLine}`,
      choices: choices.map((d: any) => ({ id: d.id, line: d.line })),
    };
  }

  choose_board(choiceId: string): Beat {
    const result = this.data.result;
    const rng = this.sim.rng.get("meetings");
    const hit = result.qProfit >= result.expectation;
    let mood: "satisfied" | "neutral" | "displeased" = hit ? "satisfied" : "neutral";
    if (choiceId === "credit") {
      this.sim.state.patience += 3;
      for (const p of this.sim.staffProducers()) p.relationship += 4;
      mood = "satisfied";
    } else if (choiceId === "gloat") {
      mood = rng.chance(0.7) ? "satisfied" : "neutral"; // boards enjoy winners, to a point
      this.sim.state.patience += rng.chance(0.5) ? 2 : 0;
    } else if (choiceId === "askMore") {
      if (rng.chance(0.5)) {
        const gift = 5_000_000;
        this.sim.earn(0, gift);
        return { speaker: "The Board", portraitId: "board", text: `A pause. A nod. "${money(gift)}. Don't make us regret the strings we didn't attach." (They attached strings.)`, done: true };
      }
      mood = "neutral";
    } else if (choiceId === "data") {
      if (!hit && this.sim.player.history.length > 4 && rng.chance(0.5)) mood = "neutral";
      else if (!hit) mood = "displeased";
    } else if (choiceId === "blame") {
      this.sim.state.patience += 2; // owning it buys grace
      mood = hit ? "satisfied" : "neutral";
    } else if (choiceId === "blameDirector") {
      mood = hit ? "satisfied" : rng.chance(0.4) ? "neutral" : "displeased";
      const dirs = this.sim.state.people.filter((p) => p.role === "director" && p.signedByStudio === 0);
      for (const d of dirs) d.relationship -= 10;
    }
    if (mood === "displeased") this.sim.state.patience -= 3;
    if (this.sim.state.patience <= 0) this.sim.state.gameOver = { kind: "fired", day: this.sim.state.day };
    return {
      speaker: "The Board",
      portraitId: "board",
      text: this.dlg().pick(this.M.reactions[mood] as string[]),
      done: true,
    };
  }

  // ---------- packaging ----------
  // The exec's real craft: assemble director + leads from real candidates with real tradeoffs.
  start_packaging(): Beat {
    const m = this.sim.movie(this.event.data.movieId);
    if (!m || m.phase !== "script") return { speaker: "Packaging", text: "This project moved on without a packaging session.", done: true };
    this.data.movie = m;
    const day = this.sim.state.day;
    const free = this.sim.state.people.filter((p) => p.role === "director" && p.busyUntil <= day);
    const ideal = this.sim.person((m as any).idealDirectorId);
    const cands: Person[] = [];
    if (ideal && ideal.busyUntil <= day) cands.push(ideal);
    for (const d of [...free].sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0))) {
      if (cands.length >= 3) break;
      if (!cands.includes(d)) cands.push(d);
    }
    this.data.directorCands = cands;
    if (!cands.length) {
      return { speaker: "Packaging", text: `Every director in town is booked. ${m.title} shoots with whoever pre-pro can find.`, done: true, };
    }
    return {
      speaker: `Packaging: ${m.title}`,
      portraitId: this.sim.person(m.producerId)?.id,
      text: `${this.sim.person(m.producerId)?.name ?? "Your producer"} spreads headshots across the desk. "Director first. Everything else follows the director."`,
      choices: cands.map((d) => ({
        id: `dir_${d.id}`,
        line: `${d.name} — ${d.archetype.replace(/-/g, " ")} · craft ${d.avgRating} · ~${d.avgVfxShots} VFX · ${d.avgLocations} locations · ${d.avgReshoots} reshoots · runs a ${d.avgCastCooperation}-harmony set${d === ideal ? " (the writer's pick)" : ""}`,
      })),
    };
  }

  choose_packaging(choiceId: string): Beat {
    const m: Movie = this.data.movie;
    if (choiceId.startsWith("dir_")) {
      const d = this.sim.person(choiceId.slice(4))!;
      m.directorId = d.id;
      d.busyUntil = this.sim.state.day + 200;
      d.signedByStudio = 0;
      // lead options: three flavors of star math
      const day = this.sim.state.day;
      const freeCast = this.sim.state.people.filter((p) => p.role === "cast" && p.busyUntil <= day);
      const byFame = [...freeCast].sort((a, b) => (b.fame ?? 0) - (a.fame ?? 0));
      const byRate = [...freeCast].sort((a, b) => (a.dailyRate ?? 0) - (b.dailyRate ?? 0));
      const byCoop = [...freeCast].sort((a, b) => (b.cooperation ?? 0) - (a.cooperation ?? 0));
      const opts: { id: string; label: string; ids: string[] }[] = [];
      const pair = (arr: Person[], tag: string, why: string) => {
        const pick = arr.filter((p) => !opts.some((o) => o.ids.includes(p.id))).slice(0, 2);
        if (pick.length) opts.push({ id: `cast_${tag}`, label: `${pick.map((p) => p.name).join(" + ")} — ${why}`, ids: pick.map((p) => p.id) });
      };
      pair(byFame, "fame", `star power (fame ${byFame[0]?.fame ?? "?"}, rates to match)`);
      pair(byRate, "value", `the value play (cheap, hungry)`);
      pair(byCoop, "smooth", `the no-drama set (cooperation first)`);
      this.data.castOpts = opts;
      if (!opts.length) {
        this.sim.startPrepro(m);
        return { speaker: `Packaging: ${m.title}`, text: `${d.name} is in. Casting will have to scrape the open-call barrel — town's busy.`, done: true };
      }
      return {
        speaker: `Packaging: ${m.title}`,
        portraitId: d.id,
        text: `${d.name} signs on the line. "Now — who am I pointing this camera at?"`,
        choices: opts.map((o) => ({ id: o.id, line: o.label })),
      };
    }
    const opt = (this.data.castOpts as any[]).find((o) => o.id === choiceId);
    if (opt) m.idealCastIds = opt.ids;
    this.sim.startPrepro(m);
    const names = opt ? opt.ids.map((id: string) => this.sim.person(id)?.name).join(" and ") : "the leads";
    return {
      speaker: `Packaging: ${m.title}`,
      portraitId: m.producerId ? this.sim.person(m.producerId)?.id : undefined,
      text: `The package: ${this.sim.person(m.directorId)?.name} directing, ${names} up top. Casting interviews go out — agents get their calls. Pre-production rolls.`,
      done: true,
    };
  }

  // ---------- premiere ----------
  start_premiere(): Beat {
    const m = this.sim.movie(this.event.data.movieId);
    if (!m) return { speaker: "Premiere", text: "The theater is dark. Wrong night?", done: true };
    this.data.movie = m;
    return {
      speaker: "Premiere Night",
      portraitId: "crowd",
      text: `The marquee reads "${m.title}". ${this.sim.line("premiere-carpet")}\nA microphone appears under your chin.`,
      choices: (this.M.carpetLines as any[]).map((c) => ({ id: c.id, line: c.line })),
    };
  }

  choose_premiere(choiceId: string): Beat {
    const m: Movie = this.data.movie;
    if (this.stage === 0) {
      this.stage = 1;
      if (choiceId === "bold") m.hype = Math.min(100, m.hype + 4);
      const fan = m.fanScore ?? 50;
      const crowd = fan > 65 ? "good" : fan > 45 ? "mixed" : "bad";
      const stars = m.reviews.length ? (m.reviews.reduce((s, r) => s + r.stars, 0) / m.reviews.length).toFixed(1) : "?";
      return {
        speaker: "Premiere Night",
        portraitId: "crowd",
        text: `Lights down. Ninety-some minutes later:\n${this.sim.line(`premiere-crowd-${crowd}`)}\nFirst reviews hit phones at the afterparty: ${stars}★. Your table looks at you. Glasses hover.`,
        choices: (this.M.toasts as any[]).map((t) => ({ id: t.id, line: t.line })),
      };
    }
    const star = this.sim.person(m.castIds[0]);
    const director = this.sim.person(m.directorId);
    if (choiceId === "star" && star) star.relationship += 8;
    if (choiceId === "director" && director) director.relationship += 8;
    if (choiceId === "room") {
      if (star) star.relationship += 3;
      if (director) director.relationship += 3;
    }
    return {
      speaker: "Premiere Night",
      portraitId: "crowd",
      text: `Glasses up. Whatever the numbers say Monday, tonight the studio bought the good champagne.${(m.fanScore ?? 0) > 65 ? " And tonight, it's earned." : ""}`,
      done: true,
    };
  }

  // ---------- lunch ----------
  // The intel faucet. Deals happen at lunch; so does knowing things.
  start_lunch(): Beat {
    const p = this.sim.person(this.event.data.personId);
    if (!p) return { speaker: "Lunch", text: "They cancelled. Their assistant sounded genuinely sorry, which means they weren't.", done: true };
    this.data.person = p;
    this.data.businessFactory = () => this.lunchTableBeat();
    return this.greetingBeat(
      p,
      `They order ${["the fish, off-menu", "a salad they won't eat", "two espressos, no food", "whatever you're having, which is a power move"][this.sim.rng.get("meetings").int(0, 3)]}. The table is yours.`
    );
  }

  private lunchTableBeat(): Beat {
    const p: Person = this.data.person;
    return {
      speaker: `Lunch with ${p.name}`,
      portraitId: p.id,
      text: voiceLine(this.content, p, `"So. To what do I owe the ${["fish", "salad", "espresso", "pleasure"][this.sim.rng.get("meetings").int(0, 3)]}?"`, this.dlg()),
      tell: this.tell(),
      rapport: this.data.rapport,
      choices: (this.M.plays as any[]).map((c) => ({ id: c.id, line: c.line })),
    };
  }

  choose_lunch(choiceId: string): Beat {
    const p: Person = this.data.person;
    const rng = this.sim.rng.get("meetings");
    if (this.data.phase === "greeting") return this.handleGreeting(choiceId, p);
    if (this.data.phase === "schmooze") return this.handleSchmooze(choiceId, p);
    const bonus = this.data.rapport > 60 ? 3 : 0;
    if (choiceId === "flatter") {
      p.relationship += rng.int(6, 12) + bonus;
      const credit = p.filmography[p.filmography.length - 1];
      remember(p, this.sim.state.day, "you took them to lunch and meant it", 8);
      return {
        speaker: `Lunch with ${p.name}`,
        portraitId: p.id,
        text: `${credit ? `You bring up ${credit.title}. ` : ""}They wave it off with the hand not holding the fork, then talk about it for nineteen minutes. The check arrives pre-warmed.`,
        sentiment: "happy",
        memoryNote: `${p.name.split(" ")[0]} will remember this lunch.`,
        done: true,
      };
    }
    if (choiceId === "business") {
      p.relationship += 4 + bonus;
      const free = p.busyUntil <= this.sim.state.day;
      this.sim.addIntel("availability", p.id, free ? `${p.name} is available and hungry for work` : `${p.name} is locked up until day ${p.busyUntil}`, true);
      return {
        speaker: `Lunch with ${p.name}`,
        portraitId: p.id,
        text: free
          ? `"For you? My calendar could open." (${p.name} is available — that's leverage, filed for later.)`
          : `"I'm committed until day ${p.busyUntil}. After that — call me before anyone else does." (Filed for later.)`,
        done: true,
      };
    }
    // gossip → INTEL, the meeting currency. High rapport buys the good stuff.
    p.relationship += 3 + bonus;
    const rivals = this.sim.state.studios.filter((s) => !s.isPlayer && !s.bankrupt);
    const rival = rivals.length ? rng.pick(rivals) : undefined;
    const hotGenre = Object.entries(this.sim.state.audience.fads).sort((a, b) => b[1] - a[1])[0][0];
    const others = this.sim.state.people.filter((x) => x.role === "cast" && x.signedByStudio !== 0 && x.id !== p.id);
    const subject = others.length ? rng.pick(others) : undefined;
    const kinds: [string, string, Intel["kind"], string | undefined][] = [
      [`${rival?.name ?? "Somebody"} is bleeding money on their ${hotGenre} picture`, rival?.name ?? "", "flop", rival?.name],
      [`${hotGenre} is testing through the roof this season`, "", "taste", undefined],
      [`${subject?.name ?? "A name you'd know"} is miserable at ${this.sim.state.studios[subject?.signedByStudio ?? 1]?.name ?? "their studio"} and taking calls`, "", "gossip", subject?.id],
    ];
    const [text, , kind, subjectId] = rng.pick(kinds);
    const reliable = this.data.rapport > 55 ? true : rng.chance(0.8); // low-rapport lunches get you the cheap stuff
    this.sim.addIntel(kind, subjectId, text, reliable);
    return {
      speaker: `Lunch with ${p.name}`,
      portraitId: p.id,
      text: `They glance around, lean in.\n"${text}."\nWorth the price of the fish. (Intel banked — spend it in a meeting.)`,
      sentiment: "happy",
      done: true,
    };
  }

  // ---------- festival ----------
  start_festival(): Beat {
    const rng = this.sim.rng.get("meetings");
    const F = this.sim.content.economy.festival;
    const films: any[] = [];
    for (let i = 0; i < F.films; i++) {
      const genre = rng.pick(Object.keys(this.sim.content.pitches.genres));
      const quality = rng.int(F.qualityRange[0], F.qualityRange[1]);
      const price = Math.round((F.priceRange[0] + rng.next() * (F.priceRange[1] - F.priceRange[0])) / 250000) * 250000;
      films.push({ title: `${rng.pick(["The", "A"])} ${rng.pick(["Quiet", "Long", "Bright", "Hollow", "Patient"])} ${rng.pick(["Winter", "Harvest", "Door", "River", "Sound"])}`, genre, quality, price, buzz: quality + rng.int(-15, 15) });
    }
    this.data.films = films;
    return {
      speaker: "Sundown Festival",
      portraitId: "crowd",
      text: `${this.sim.line("festival-banter")}\nThree finished films are taking offers. You've seen the buzz scores. You have NOT seen the films — nobody buys after seeing the film, that's not how faith works.`,
      choices: [
        ...films.map((f: any, i: number) => ({ id: `buy_${i}`, line: `Acquire "${f.title}" (${f.genre}) — buzz ${f.buzz}/100, asking ${money(f.price)}` })),
        { id: "pass", line: "Keep the checkbook closed. Enjoy the pine air." },
      ],
    };
  }

  choose_festival(choiceId: string): Beat {
    if (choiceId === "pass") return { speaker: "Sundown Festival", portraitId: "crowd", text: "You leave with a tote bag and your money. One of these films will haunt you from a rival's slate. Probably the quiet one.", done: true };
    const f = (this.data.films as any[])[parseInt(choiceId.slice(4), 10)];
    if (this.sim.player.cash < f.price) return { speaker: "Sundown Festival", portraitId: "crowd", text: "Your business affairs person mouths 'we cannot afford this' across the lobby. The moment passes.", done: true };
    const writer = this.sim.rng.get("meetings").pick(this.sim.state.people.filter((p) => p.role === "writer"));
    const m = this.sim.createMovie(0, writer, {
      title: f.title, genre: f.genre, subgenre: "Festival Darling", estRating: "R", targetLength: 104,
      minBudget: f.price, estVfx: 10, hook: "FESTIVAL", logline: "you bought it on faith and a panel Q&A", idealCastIds: [],
    } as any);
    this.sim.spend(0, f.price);
    m.spent = f.price;
    m.budget = f.price;
    m.acquired = true;
    m.phase = "post";
    m.dailyCost = 5000;
    const q = f.quality;
    m.quality = { script: q, direction: q, performance: q, vfx: Math.max(20, q - 10), polish: q };
    m.screeningScore = f.buzz;
    m.hype = Math.min(60, Math.round(f.buzz / 2));
    m.actualVfx = 10;
    this.sim.marketingEmail(m, `The ink dries on "${f.title}". It's yours. It was always going to be yours — everyone saw how you looked at it.`, true);
    return { speaker: "Sundown Festival", portraitId: "crowd", text: `Handshakes, flashbulbs, a director openly weeping with gratitude. "${f.title}" is a ${this.sim.content.game.studioName} picture now. Marketing memo is already in your inbox.`, done: true };
  }

  // ---------- production review ----------
  start_productionReview(): Beat {
    const movie = this.sim.movie(this.event.data.movieId);
    if (!movie || movie.phase !== "production") {
      return { speaker: "Set", text: "The set is quiet — this production has moved on.", done: true };
    }
    this.data.movie = movie;
    const dirPerson = this.sim.person(movie.directorId);
    if (dirPerson) {
      this.data.businessFactory = () => this.prodReviewBusinessBeat();
      return this.greetingBeat(dirPerson, `Set visit: "${movie.title}", day ${this.sim.state.day - movie.phaseStart} of the shoot. The monitors glow. Something is clearly on their mind.`);
    }
    return this.prodReviewBusinessBeat();
  }

  private prodReviewBusinessBeat(): Beat {
    const movie: Movie = this.data.movie;
    const director = this.sim.person(movie.directorId);
    const rng = this.sim.rng.get("meetings");
    const kinds = ["behind", "over", "friction", "scope"] as const;
    const kind = rng.pick([...kinds]);
    this.data.kind = kind;
    const cast = this.sim.person(movie.castIds[0]);
    const problems = this.M.problems as Record<string, string>;
    const askCost = Math.round(movie.budget * 0.05);
    const splitCost = Math.round(movie.budget * 0.025);
    this.data.askCost = askCost;
    const text = fill(problems[kind], {
      days: rng.int(3, 12),
      cost: money(movie.dailyCost * 7),
      pct: rng.int(8, 30),
      department: rng.pick(["catering", "practical effects", "wardrobe", "stunt"]),
      cast: cast?.name ?? "the lead",
      shots: rng.int(20, 60),
      trust: rng.int(2, 9),
    });
    const stakes: Record<string, string> = {
      behind: "THE ASK: more time.",
      over: "THE ASK: a bigger budget.",
      friction: "THE ASK: you pick a side, or at least a referee.",
      scope: "THE ASK: more VFX shots.",
    };
    return {
      speaker: director?.name ?? "The Director",
      portraitId: director?.id,
      text:
        `*walks you through the set of ${movie.title}* "${text}"\n\n` +
        `${stakes[kind]}\n` +
        `— Give them what they want: +${money(askCost)} to the budget, quality and morale up.\n` +
        `— Hold the line: free, but risks a setback if the set turns on you.\n` +
        `— Split the difference: +${money(splitCost)}, keeps the peace, no upside.\n` +
        `— Threaten the schedule: free, can pull the wrap date IN — or blow up in your face.`,
      choices: (this.M.plays as any[]).map((p) => ({ id: p.id, line: p.line })),
    };
  }

  choose_productionReview(choiceId: string): Beat {
    const movie: Movie = this.data.movie;
    if (!movie) return { speaker: "Set", text: "…", done: true };
    const director = this.sim.person(movie.directorId);
    const rng = this.sim.rng.get("meetings");
    let mood: "good" | "ok" | "bad" = "ok";
    if (choiceId === "approve") {
      const cost = Math.round(movie.budget * 0.05);
      this.sim.spend(0, cost);
      movie.spent += cost;
      movie.budget += cost;
      movie.quality.direction = Math.min(100, movie.quality.direction + 5);
      movie.hype += 3;
      if (director) director.relationship += 8;
      mood = "good";
    } else if (choiceId === "hold") {
      if (director) director.relationship -= 4;
      mood = rng.chance(0.6) ? "ok" : "bad";
      if (mood === "bad") movie.setbackCount++;
    } else if (choiceId === "split") {
      const cost = Math.round(movie.budget * 0.025);
      this.sim.spend(0, cost);
      movie.spent += cost;
      mood = "ok";
    } else if (choiceId === "threaten") {
      const coop = director?.avgCastCooperation ?? 50;
      if (rng.chance(coop / 120)) {
        // it works: schedule protected
        mood = "good";
        const wrap = this.sim.state.events.find((e) => e.type === "productionWrap" && e.data.movieId === movie.id);
        if (wrap) wrap.day = Math.max(this.sim.state.day + 3, wrap.day - 4);
      } else {
        mood = "bad";
        movie.setbackCount++;
        if (director) director.relationship -= 10;
      }
    }
    return {
      speaker: director?.name ?? "The Director",
      portraitId: director?.id,
      text: this.dlg().pick(this.M.reactions[mood] as string[]),
      done: true,
    };
  }

  // ---------- convention ----------
  start_convention(): Beat {
    const upcoming = this.sim.state.movies.filter((m) => m.studio === 0 && ["script", "prepro", "production", "post"].includes(m.phase));
    if (!upcoming.length) {
      return { speaker: "Summer-Con", text: "You walk the floor with nothing to show. A fan asks if you're somebody. You say no. It's easier.", done: true };
    }
    this.data.movie = upcoming.sort((a, b) => b.budget - a.budget)[0];
    const m: Movie = this.data.movie;
    return {
      speaker: "Summer-Con",
      portraitId: "crowd",
      text: `The hall is packed. The banner behind you reads "${m.title}". The crowd wants a reveal. How much do you give them?`,
      choices: (this.M.reveals as any[]).map((r) => ({ id: r.id, line: r.line })),
    };
  }

  choose_convention(choiceId: string): Beat {
    const m: Movie = this.data.movie;
    if (this.stage === 0) {
      this.stage = 1;
      const reveal = (this.M.reveals as any[]).find((r) => r.id === choiceId)!;
      const rng = this.sim.rng.get("meetings");
      let hype = rng.int(reveal.hype[0], reveal.hype[1]);
      if (choiceId === "trailer" && m.phase !== "post") hype = Math.min(hype, 2); // nothing to show
      if (choiceId === "star") {
        const star = this.sim.person(m.castIds[0]);
        if (!star || (star.cooperation ?? 50) < 30) hype = Math.floor(hype / 2);
      }
      m.hype = Math.max(0, Math.min(100, m.hype + hype));
      this.data.hype = hype;
      const q = fill(bankLine(this.dlg(), this.content, "fan-question"), { franchise: m.franchise ?? "Lightning Rod" });
      return {
        speaker: "Fan at mic #2",
        portraitId: "crowd",
        text: `${hype >= 12 ? "The room ERUPTS." : hype >= 5 ? "Solid pop. Phones up, posting." : "Polite applause. One guy boos supportively."}\nQ&A time: "${q}"`,
        choices: (this.M.answers as any[]).map((a) => ({ id: a.id, line: a.line })),
      };
    }
    if (choiceId === "commit") {
      m.hype = Math.min(100, m.hype + 6);
      this.sim.state.flags[`canonPromise_${m.id}`] = true;
      return { speaker: "Summer-Con", portraitId: "crowd", text: "The clip is already everywhere. You've made a promise the internet has screenshots of.", done: true };
    }
    return { speaker: "Summer-Con", portraitId: "crowd", text: "A groan, then laughter. Deflection is a skill and you have it.", done: true };
  }

  // ---------- awards ----------
  start_awards(): Beat {
    // nominate: best released movie this year by quality
    const year = calDate(this.sim.state.day).year;
    const eligible = this.sim.state.movies
      .filter((m) => m.releaseDay !== undefined && calDate(m.releaseDay).year === year)
      .sort((a, b) => this.sim.movieQuality(b) - this.sim.movieQuality(a));
    const yours = eligible.find((m) => m.studio === 0);
    this.data.nominee = yours;
    this.data.field = eligible.slice(0, 4);
    if (!yours) {
      return {
        speaker: "The Golden Marquees",
        portraitId: "crowd",
        text: `${bankLine(this.dlg(), this.content, "award-banter")}\nNothing of yours was eligible this year. You're here for the shrimp, and the shrimp is excellent.`,
        done: true,
      };
    }
    const star = this.sim.person(yours.castIds[0]);
    return {
      speaker: star?.name ?? "Your table",
      portraitId: star?.id,
      text: `${bankLine(this.dlg(), this.content, "award-banter")}\n"${yours.title}" is up for Best Picture. ${star ? `${star.name} sits beside you, vibrating at a frequency only agents can hear.` : ""}`,
      choices: (this.M.tableTalk as any[]).map((t) => ({ id: t.id, line: t.line })),
    };
  }

  choose_awards(choiceId: string): Beat {
    const m: Movie | undefined = this.data.nominee;
    const star = m ? this.sim.person(m.castIds[0]) : undefined;
    const rng = this.sim.rng.get("meetings");
    if (choiceId === "promise" && star) this.sim.state.flags[`sequelPromise_${m!.id}`] = true;
    if (star) star.relationship += choiceId === "manage" ? 4 : choiceId === "promise" ? 8 : 6;
    // envelope
    const field: Movie[] = this.data.field;
    const winner = rng.pickWeighted(field, (f) => Math.max(1, this.sim.movieQuality(f)) ** 2);
    const won = winner === m;
    if (won && m) {
      m.awards.push("Best Picture");
      this.sim.earn(0, this.content.economy.awards.cashPrize);
      this.sim.state.patience = Math.min(100, this.sim.state.patience + this.content.economy.patienceAwardReward);
      if (star) star.relationship += 15;
    } else if (m && star) {
      star.relationship -= 5;
    }
    const line = won ? this.dlg().pick(this.M.winLines as string[]) : this.dlg().pick(this.M.loseLines as string[]);
    return {
      speaker: "The Golden Marquees",
      portraitId: "crowd",
      text: `The envelope. "${winner?.title ?? "..."}" — ${this.sim.state.studios[winner?.studio ?? 1].name}.\n${line}${won ? `\nPrize deals: ${money(this.content.economy.awards.cashPrize)}.` : ""}`,
      done: true,
    };
  }

  // ---------- exec standup ----------
  start_execStandup(): Beat {
    // pick nearest threat: cash runway / runaway production / rival momentum
    const st = this.sim.state;
    const burn = this.content.economy.overheadDaily + st.movies.filter((m) => m.studio === 0 && (m.phase === "production" || m.phase === "post")).reduce((s, m) => s + m.dailyCost, 0);
    const runwayDays = this.sim.player.cash / Math.max(1, burn);
    const runaway = st.movies.find((m) => m.studio === 0 && m.phase === "production" && m.setbackCount >= 2);
    const ranked = [...st.studios].sort((a, b) => b.totalRevenue - b.totalSpent - (a.totalRevenue - a.totalSpent));
    const topRival = ranked.find((s) => !s.isPlayer)!;
    let nag: string;
    if (runwayDays < 90) nag = bankLine(this.dlg(), this.content, "exec-nag-cash");
    else if (runaway) nag = bankLine(this.dlg(), this.content, "exec-nag-production");
    else nag = bankLine(this.dlg(), this.content, "exec-nag-rival", { rival: topRival.name });
    const d = calDate(st.day + 28);
    return {
      speaker: "Whit Pemberton (Board Liaison)",
      portraitId: "exec",
      text: `*perches on your desk, moves your stapler an inch* "${nag}"`,
      choices: (this.M.plays as any[]).map((p) => ({ id: p.id, line: fill(p.line, { deadline: `week ${d.week}` }) })),
    };
  }

  choose_execStandup(choiceId: string): Beat {
    const rng = this.sim.rng.get("meetings");
    let mood: "good" | "neutral" | "bad" = "neutral";
    if (choiceId === "commit") {
      this.sim.state.flags.execDeadline = { day: this.sim.state.day + 28, profitAtCommit: this.sim.player.totalRevenue - this.sim.player.totalSpent };
      mood = "good";
      this.sim.state.patience += 1;
    } else if (choiceId === "pushback") {
      mood = rng.chance(0.4 + this.sim.state.patience / 250) ? "neutral" : "bad";
      if (mood === "bad") this.sim.state.patience -= 2;
    } else {
      mood = rng.chance(0.6) ? "neutral" : "good";
      if (mood === "good") this.sim.state.patience += 1;
    }
    return {
      speaker: "Whit Pemberton (Board Liaison)",
      portraitId: "exec",
      text: this.dlg().pick(this.M.reactions[mood] as string[]),
      done: true,
    };
  }

  // ---------- producers standup ----------
  // Weekly. Each producer reports their own slate: phase, days to next milestone, burn,
  // and flags. Flagged projects offer a concrete fix (cost stated) or you let it ride.
  start_producersStandup(): Beat {
    const staff = this.sim.staffProducers();
    if (!staff.length) return { speaker: "Empty Room", text: "You have no producers on staff. That is a problem with a hiring-shaped solution.", done: true };
    const day = this.sim.state.day;
    const sections: string[] = [];
    const flagged: Movie[] = [];
    for (const prod of staff) {
      const slate = this.sim.state.movies.filter((m) => m.producerId === prod.id && ["prepro", "production", "post"].includes(m.phase));
      if (!slate.length) {
        sections.push(fill(bankLine(this.dlg(), this.content, "standup-free-producer"), { producer: prod.name }));
        continue;
      }
      const over = slate.length > this.content.economy.producers.idealLoad;
      const head = over
        ? fill(bankLine(this.dlg(), this.content, "standup-overloaded"), { producer: prod.name, n: slate.length })
        : `${prod.name} (${slate.length} project${slate.length > 1 ? "s" : ""}):`;
      const lines = slate.map((m) => {
        const daysLeft = Math.max(0, m.phaseEnd - day);
        const milestone = m.phase === "prepro" ? "pre-pro wrap" : m.phase === "production" ? "picture wrap" : "final cut";
        const flags = m.setbackCount > 0 ? ` ⚠ ${m.setbackCount} setback${m.setbackCount > 1 ? "s" : ""}` : "";
        if (m.setbackCount > 0 && m.phase === "production") flagged.push(m);
        return `   • ${m.title}: ${m.phase.toUpperCase()}, ${daysLeft}d to ${milestone}, burning ${money(m.dailyCost)}/day${flags}`;
      });
      sections.push([head, ...lines].join("\n"));
    }
    this.data.flagged = flagged;
    const choices = flagged.map((m) => ({
      id: `fix_${m.id}`,
      line: `Throw money at ${m.title} (${money(Math.round(m.budget * 0.025))} — clears a setback, claws back 3 days)`,
    }));
    choices.push({ id: "ride", line: flagged.length ? "Let it all ride. Setbacks build character." : "Good. Back to work, all of you." });
    return {
      speaker: "Producers Standup",
      portraitId: "producers",
      text: sections.join("\n\n"),
      choices,
    };
  }

  choose_producersStandup(choiceId: string): Beat {
    if (choiceId.startsWith("fix_")) {
      const m = this.sim.movie(choiceId.slice(4));
      if (m) {
        const cost = Math.round(m.budget * 0.025);
        this.sim.spend(0, cost);
        m.spent += cost;
        m.setbackCount = Math.max(0, m.setbackCount - 1);
        const wrap = this.sim.state.events.find((e) => (e.type === "productionWrap" || e.type === "vfxDone") && e.data.movieId === m.id);
        if (wrap) wrap.day = Math.max(this.sim.state.day + 2, wrap.day - 3);
        m.phaseEnd = Math.max(this.sim.state.day + 2, m.phaseEnd - 3);
        const producer = this.sim.person(m.producerId);
        return {
          speaker: producer?.name ?? "Producer",
          portraitId: producer?.id,
          text: `"Consider it handled." (${m.title}: setback cleared, schedule pulled in 3 days, ${money(cost)} lighter.)`,
          done: true,
        };
      }
    }
    return { speaker: "Producers Standup", portraitId: "producers", text: "Coffee cups clatter. Everyone scatters to their sets.", done: true };
  }
}
