// Dialogue encounters. The player picks lines; the counterpart decides.
// Each meeting is a tiny state machine over content-defined beats.

import type { Sim } from "./sim";
import type { Movie, Person, SimEvent } from "./types";
import { bankLine, fill, money } from "./text";
import { calDate, SEASONS, DAYS_PER_WEEK } from "./types";

export interface Choice {
  id: string;
  line: string;
}

export interface Beat {
  speaker: string;
  portraitId?: string; // person id for portrait, or role tag
  text: string;
  choices?: Choice[];
  done?: boolean;
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
    const fn = (this as any)[`choose_${this.event.type}`];
    return fn.call(this, choiceId);
  }

  // ---------- pitch ----------
  // Ask as many probes as you like — each wears the writer's HIDDEN patience. You read it
  // from the parenthetical tells. A worn-out writer can reject even a full-price offer.
  start_pitch(): Beat {
    const writer = this.sim.person(this.event.data.writerId)!;
    const p = this.event.data.pitch;
    this.data.writer = writer;
    const rng = this.sim.rng.get("meetings");
    this.data.patience = 55 + writer.relationship / 2 + rng.int(-10, 10);
    this.data.asked = [] as string[];
    return {
      speaker: writer.name,
      portraitId: writer.id,
      text: `*slides a one-sheet across the table* "${p.title}." ${p.genre}/${p.subgenre}, ${p.estRating}. ${p.logline}. Cost to greenlight a script: ${money(
        p.minBudget * this.content.economy.phases.greenlightScriptFactor
      )}.`,
      choices: this.pitchChoices(),
    };
  }

  private pitchChoices() {
    return [
      ...(this.M.probes as any[]).filter((pr) => !this.data.asked.includes(pr.id)).map((pr) => ({ id: `probe_${pr.id}`, line: pr.line })),
      ...(this.M.positions as any[]).map((po) => ({ id: `pos_${po.id}`, line: po.line })),
    ];
  }

  private patienceTell(): string {
    const p = this.data.patience;
    const bank = p > 55 ? "patience-tell-high" : p > 30 ? "patience-tell-mid" : "patience-tell-low";
    return bankLine(this.dlg(), this.content, bank);
  }

  choose_pitch(choiceId: string): Beat {
    const writer: Person = this.data.writer;
    const p = this.event.data.pitch;
    const rng = this.sim.rng.get("meetings");
    if (choiceId.startsWith("probe_")) {
      const probe = (this.M.probes as any[]).find((x) => `probe_${x.id}` === choiceId)!;
      this.data.asked.push(probe.id);
      this.data.patience -= rng.int(8, 18);
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
        text: `${reveal}\n${this.patienceTell()}`,
        choices: this.pitchChoices(),
      };
    }
    const pos = (this.M.positions as any[]).find((x) => `pos_${x.id}` === choiceId)!;
    writer.relationship += pos.writerMood;
    if (pos.id === "greenlight" || pos.id === "cheap") {
      // their decision weighs the offer, the relationship, and how the meeting went
      const base = pos.id === "greenlight" ? 0.85 : 0.45;
      const odds = base + writer.relationship / 200 + (this.data.patience - 50) / 180 + (writer.archetype === "pulp-factory" ? 0.1 : 0);
      const accepted = rng.chance(Math.max(0.1, Math.min(0.97, odds)));
      if (accepted) {
        const m = this.sim.createMovie(0, writer, p);
        (m as any).idealDirectorId = p.idealDirectorId;
        this.sim.startScript(m, writer);
        return {
          speaker: writer.name,
          portraitId: writer.id,
          text: fill(this.dlg().pick(this.M.reactions.accept as string[]), { writer: writer.name }),
          done: true,
        };
      }
      writer.relationship -= 6;
      return {
        speaker: writer.name,
        portraitId: writer.id,
        text: `${fill(this.dlg().pick(this.M.reactions.walk as string[]), { writer: writer.name })}\n(The meeting ran long. They were gone before you finished the offer.)`,
        done: true,
      };
    }
    // pass
    return {
      speaker: writer.name,
      portraitId: writer.id,
      text: fill(this.dlg().pick(this.M.reactions.walk as string[]), { writer: writer.name }),
      done: true,
    };
  }

  // ---------- casting ----------
  start_casting(): Beat {
    const cast = this.sim.person(this.event.data.castId)!;
    const movie = this.sim.movie(this.event.data.movieId)!;
    this.data.cast = cast;
    this.data.movie = movie;
    const rng = this.dlg();
    const open = fill(rng.pick(this.M.opens as string[]), { cast: cast.name, lateness: 10 + Math.round((100 - (cast.cooperation ?? 50)) / 4) });
    const ask = rng.pick(this.M.asks as string[]);
    const flop = cast.filmography.filter((f) => f.profit < 0).sort((a, b) => b.stars - a.stars)[0];
    this.data.flatterTitle = flop?.title ?? cast.filmography[0]?.title ?? "that thing you did";
    return {
      speaker: cast.name,
      portraitId: cast.id,
      text: `${open}\n"${ask}"\n(Rate: ${money(cast.dailyRate ?? 0)}/day. Rider: ${cast.rider}. For: ${movie.title})`,
      choices: (this.M.plays as any[]).map((pl) => ({ id: pl.id, line: fill(pl.line, { flatterTitle: this.data.flatterTitle }) })),
    };
  }

  choose_casting(choiceId: string): Beat {
    const cast: Person = this.data.cast;
    const movie: Movie = this.data.movie;
    const rng = this.sim.rng.get("meetings");
    let key: keyof typeof this.M.reactions = "accept";
    let signed = true;
    let rateMult = 1;
    if (choiceId === "meet") {
      key = "accept";
      cast.relationship += 8;
    } else if (choiceId === "counterLow") {
      rateMult = 0.65;
      const odds = 0.35 + (cast.cooperation ?? 50) / 200 + cast.relationship / 150 + ((cast.fame ?? 50) < 40 ? 0.2 : 0);
      if (rng.chance(Math.max(0.1, Math.min(0.85, odds)))) {
        key = "acceptGrudge";
        cast.relationship -= 5;
      } else {
        signed = false;
        key = "walk";
        cast.relationship -= 10;
      }
    } else if (choiceId === "backend") {
      rateMult = 0.4;
      const odds = 0.3 + (cast.improv ?? 50) / 180 + cast.relationship / 120;
      if (rng.chance(Math.max(0.1, Math.min(0.8, odds)))) {
        key = "accept";
        this.sim.state.flags[`backend_${movie.id}_${cast.id}`] = true;
      } else {
        signed = false;
        key = "walk";
      }
    } else if (choiceId === "flatter") {
      cast.relationship += 12;
      const odds = 0.55 + cast.relationship / 150;
      if (rng.chance(Math.min(0.92, odds))) {
        key = "acceptGrudge";
        rateMult = 0.85;
      } else {
        key = "demand";
        rateMult = 1.1;
      }
      // demand still signs — at a price
    }
    if (signed) {
      movie.castIds.push(cast.id);
      cast.busyUntil = this.sim.state.day + 150;
      cast.signedByStudio = 0;
      const rateCost = Math.round((cast.dailyRate ?? 20000) * rateMult * 30);
      movie.budget += rateCost;
      this.sim.state.flags[`rate_${movie.id}_${cast.id}`] = rateCost;
    }
    return {
      speaker: cast.name,
      portraitId: cast.id,
      text: this.dlg().pick(this.M.reactions[key] as string[]),
      done: true,
    };
  }

  // ---------- board ----------
  start_board(): Beat {
    const tier = this.sim.toneTier();
    const tone = ["warm", "curt", "cold", "hostile"][tier];
    const result = this.sim.applyQuarterResult();
    this.data.result = result;
    const open = bankLine(this.dlg(), this.content, `board-open-${tone}`);
    return {
      speaker: "The Board",
      portraitId: "board",
      text: `${open}\nQuarter: ${money(result.qProfit)} against an expectation of ${money(result.expectation)}. ${
        result.qProfit >= result.expectation ? "Adequate." : "Explain."
      }`,
      choices: (this.M.defenses as any[]).map((d) => ({ id: d.id, line: d.line })),
    };
  }

  choose_board(choiceId: string): Beat {
    const result = this.data.result;
    const rng = this.sim.rng.get("meetings");
    const hit = result.qProfit >= result.expectation;
    let mood: "satisfied" | "neutral" | "displeased" = hit ? "satisfied" : "neutral";
    if (choiceId === "data") {
      if (!hit && this.sim.player.history.length > 4 && rng.chance(0.5)) mood = "neutral";
      else if (!hit) mood = "displeased";
    } else if (choiceId === "blame") {
      this.sim.state.patience += 2; // owning it buys grace
      mood = hit ? "satisfied" : "neutral";
    } else if (choiceId === "blameDirector") {
      mood = hit ? "satisfied" : rng.chance(0.4) ? "neutral" : "displeased";
      // it gets back to them
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

  // ---------- production review ----------
  start_productionReview(): Beat {
    const movie = this.sim.movie(this.event.data.movieId);
    if (!movie || movie.phase !== "production") {
      return { speaker: "Set", text: "The set is quiet — this production has moved on.", done: true };
    }
    this.data.movie = movie;
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
