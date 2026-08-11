// Calendar app: week grid + season ribbon with release pins. Windowed (BossOS).

import { useState } from "preact/hooks";
import type { Sim } from "../kernel/sim";
import { calDate, DAYS_PER_WEEK, DOW, SEASONS } from "../kernel/types";
import type { OpenDossier } from "./dossiers";

const EVT_LABELS: Record<string, string> = {
  pitch: "🎬 Pitch Meeting",
  casting: "🎤 Casting Interview",
  board: "👔 Board Review",
  productionReview: "🎥 Production Review",
  convention: "🎪 Convention Showcase",
  awards: "🏆 Awards Ceremony",
  execStandup: "👔 Exec Standup",
  producersStandup: "📋 Producers Standup",
  writerPitch: "✉ incoming pitch",
  scriptDone: "📜 script delivered",
  preproDone: "📋 pre-pro wraps",
  productionWrap: "🎬 production wraps",
  vfxDone: "✨ VFX & screening",
  release: "◆ RELEASE",
  homeVideo: "📀 home video",
  rivalWrap: "🏭 rival wraps",
  producerOffer: "🤝 producer available",
  newStudioEntry: "🏗 new studio",
};

export function CalendarApp({ sim, openDossier }: { sim: Sim; openDossier: OpenDossier }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const today = sim.state.day;
  const d = calDate(today);
  const weekStart = today - d.dayOfWeek + weekOffset * DAYS_PER_WEEK;
  const slots = ["morning", "afternoon", "evening"] as const;
  const yearStart = (d.year - 1) * 336;
  const releasePins = sim.state.movies
    .map((m) => ({ m, day: m.releaseDay ?? sim.state.events.find((e) => e.type === "release" && e.data.movieId === m.id)?.day }))
    .filter((x) => x.day !== undefined && x.day >= yearStart && x.day < yearStart + 336);
  return (
    <div class="calendar-app">
      <div class="year-ribbon">
        {SEASONS.map((s, si) => (
          <div key={s} class={`season ${si === d.season ? "now" : ""}`}>
            <b>{s}</b>
            <div class="pins">
              {releasePins
                .filter((p) => calDate(p.day!).season === si)
                .slice(0, 3)
                .map((p) => (
                  <div key={p.m.id}>
                    ◆ <a class="doss-link" onClick={() => openDossier("movie", p.m.id)}>{p.m.title.slice(0, 16)}</a>
                    {p.m.studio !== 0 ? ` (${sim.state.studios[p.m.studio].name.split(" ")[0]})` : ""}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div class="week-nav">
        <button onClick={() => setWeekOffset(weekOffset - 1)}>←</button>
        <b>Week {calDate(Math.max(0, weekStart)).week}{weekOffset === 0 ? " (now)" : ""}</b>
        <button onClick={() => setWeekOffset(weekOffset + 1)}>→</button>
        {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)}>today</button>}
      </div>
      <div class="week-grid">
        <div class="head">
          <div />
          {DOW.map((n, i) => (
            <div key={n} class={i >= 5 ? "wkend" : ""}>{n}</div>
          ))}
        </div>
        {slots.map((slot) => (
          <div class="row" key={slot}>
            <div class="slotlabel">{slot}</div>
            {DOW.map((_, i) => {
              const day = weekStart + i;
              const evts = sim.state.events.filter((e) => e.day === day && e.slot === slot);
              return (
                <div key={i} class={`${day === today ? "today" : ""} ${i >= 5 ? "wkend" : ""}`}>
                  {evts.map((e) => (
                    <div
                      key={e.id}
                      class={`evt ${e.kind}`}
                      title={e.type}
                      onClick={() => e.data.movieId && openDossier("movie", e.data.movieId)}
                      style={e.data.movieId ? { cursor: "pointer" } : undefined}
                    >
                      {EVT_LABELS[e.type] ?? e.type}
                      {e.data.movieId && sim.movie(e.data.movieId) ? `: ${sim.movie(e.data.movieId)!.title.slice(0, 12)}` : ""}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p class="cal-legend">◉ meetings need you in the room · ▢ outcomes resolve themselves and land in BossMail · weekends are outcome-only</p>
    </div>
  );
}
