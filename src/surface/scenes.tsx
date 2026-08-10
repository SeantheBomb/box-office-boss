// Office (desk + inbox), Calendar wall, Reports corner scenes.

import { useState } from "preact/hooks";
import type { Sim } from "../kernel/sim";
import type { Email } from "../kernel/types";
import { calDate, DAYS_PER_WEEK, DOW, SEASONS, WEEKS_PER_SEASON } from "../kernel/types";
import { money } from "../kernel/text";
import { StandingsChart, FunnelReport, ProductionBoard, AudienceReport } from "./reports";

export function OfficeScene({ sim, bump, onNavigate, drawer }: { sim: Sim; bump: () => void; onNavigate: (s: string) => void; drawer: () => void }) {
  const [selId, setSelId] = useState<string | undefined>(sim.state.inbox[0]?.id);
  const sel = sim.state.inbox.find((e) => e.id === selId) ?? sim.state.inbox[0];
  const tier = sim.toneTier();
  const evening = sim.state.timeOfDay > 0.66;
  return (
    <div class={`office ${evening ? "evening" : ""}`}>
      <div class="window" />
      <div class={`logo ${tier >= 3 ? "doomed" : tier >= 2 ? "stressed" : ""}`}>{sim.content.game.studioName}</div>
      <div class="monitor">
        <div class="inbox-list">
          {sim.state.inbox.map((e) => (
            <div
              key={e.id}
              class={`item ${e.read ? "" : "unread"} ${sel?.id === e.id ? "sel" : ""}`}
              onClick={() => {
                e.read = true;
                setSelId(e.id);
                bump();
              }}
            >
              <div class="from">{e.from}</div>
              {e.subject}
            </div>
          ))}
        </div>
        {sel ? <ReadPane sim={sim} email={sel} bump={bump} /> : <div class="inbox-empty">Inbox zero. Suspicious.</div>}
      </div>
      <div class="doors">
        <button onClick={() => onNavigate("calendar")}>🗓 Calendar Wall</button>
        <button onClick={() => onNavigate("reports")}>📊 Reports Corner</button>
      </div>
      <div class="drawer">
        <button onClick={drawer}>🗄 Desk Drawer</button>
      </div>
    </div>
  );
}

function ReadPane({ sim, email, bump }: { sim: Sim; email: Email; bump: () => void }) {
  const d = calDate(email.day);
  const funnelMovie = email.embed?.kind === "funnel" ? sim.movie(email.embed.movieId) : undefined;
  return (
    <div class="inbox-read">
      <h3>{email.subject}</h3>
      <div class="meta">
        {email.from} · {DOW[d.dayOfWeek]} wk{d.week} yr{d.year}
      </div>
      <div class="body">{email.body}</div>
      {email.embed?.kind === "standings" && (
        <div style={{ background: "#faf6ec", color: "#1c1a17", padding: 8, marginTop: 10 }}>
          <StandingsChart sim={sim} compact />
        </div>
      )}
      {funnelMovie && (
        <div style={{ background: "#faf6ec", color: "#1c1a17", padding: 8, marginTop: 10 }}>
          <FunnelReport sim={sim} movie={funnelMovie} />
        </div>
      )}
      {email.actions.length > 0 && !email.actionTaken && (
        <div class="actions">
          {email.actions.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                sim.emailAction(email.id, a.id);
                bump();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {email.actionTaken && <div class="taken">↳ You replied: {email.actions.find((a) => a.id === email.actionTaken)?.label ?? email.actionTaken}</div>}
    </div>
  );
}

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
  setbackResolved: "🔧 setback resolved",
};

export function CalendarScene({ sim, onBack }: { sim: Sim; onBack: () => void }) {
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
    <div class="calendar">
      <h2>Year {d.year} — The Wall</h2>
      <div class="year-ribbon">
        {SEASONS.map((s, si) => (
          <div key={s} class={`season ${si === d.season ? "now" : ""}`}>
            <b>{s}</b>
            <div class="pins">
              {releasePins
                .filter((p) => calDate(p.day!).season === si)
                .slice(0, 4)
                .map((p) => (
                  <div key={p.m.id}>◆ {p.m.title.slice(0, 18)}{p.m.studio !== 0 ? ` (${sim.state.studios[p.m.studio].name.split(" ")[0]})` : ""}</div>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div class="week-nav">
        <button onClick={() => setWeekOffset(weekOffset - 1)}>← prev</button>
        <b style={{ alignSelf: "center" }}>Week {calDate(Math.max(0, weekStart)).week}{weekOffset === 0 ? " (now)" : ""}</b>
        <button onClick={() => setWeekOffset(weekOffset + 1)}>next →</button>
        <button onClick={onBack} style={{ marginLeft: "auto" }}>← back to desk</button>
      </div>
      <div class="week-grid">
        <div class="head">
          <div />
          {DOW.map((n, i) => (
            <div key={n}>{n} {calDate(weekStart + i).week !== calDate(weekStart).week ? "" : ""}</div>
          ))}
        </div>
        {slots.map((slot) => (
          <div class="row" key={slot}>
            <div class="slotlabel">{slot}</div>
            {DOW.map((_, i) => {
              const day = weekStart + i;
              const evts = sim.state.events.filter((e) => e.day === day && e.slot === slot);
              return (
                <div key={i} class={day === today ? "today" : ""}>
                  {evts.map((e) => (
                    <div key={e.id} class={`evt ${e.kind}`} title={e.type}>
                      {EVT_LABELS[e.type] ?? e.type}
                      {e.data.movieId && sim.movie(e.data.movieId) ? `: ${sim.movie(e.data.movieId)!.title.slice(0, 14)}` : ""}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>◉ meetings need you in the room · ▢ outcomes resolve themselves and hit your inbox</p>
    </div>
  );
}

export function ReportsScene({ sim, onBack }: { sim: Sim; onBack: () => void }) {
  const [tab, setTab] = useState("standings");
  const released = sim.state.movies.filter((m) => m.studio === 0 && m.releaseDay !== undefined);
  const [movieId, setMovieId] = useState<string | undefined>(undefined);
  const funnelMovie = sim.movie(movieId) ?? released[released.length - 1];
  return (
    <div class="reports">
      <div class="tabs">
        <button class={tab === "standings" ? "on" : ""} onClick={() => setTab("standings")}>📈 Box Office Standings</button>
        <button class={tab === "board" ? "on" : ""} onClick={() => setTab("board")}>🎬 Production Board</button>
        <button class={tab === "funnel" ? "on" : ""} onClick={() => setTab("funnel")}>🔻 Release Results</button>
        <button class={tab === "audience" ? "on" : ""} onClick={() => setTab("audience")}>👥 Audience</button>
        <button onClick={onBack} style={{ marginLeft: "auto" }}>← back to desk</button>
      </div>
      <div class="report-sheet">
        {tab === "standings" && (
          <div>
            <h3>Box Office Standings — profit to date (revenue − total spend)</h3>
            <StandingsChart sim={sim} />
          </div>
        )}
        {tab === "board" && <ProductionBoard sim={sim} />}
        {tab === "funnel" && (
          <div>
            {released.length > 1 && (
              <div style={{ marginBottom: 8 }}>
                {released.map((m) => (
                  <button key={m.id} style={{ marginRight: 6, padding: "3px 8px", cursor: "pointer" }} onClick={() => setMovieId(m.id)}>
                    {m.title}
                  </button>
                ))}
              </div>
            )}
            {funnelMovie ? <FunnelReport sim={sim} movie={funnelMovie} /> : <p>Release something first. The funnel awaits its first victim.</p>}
          </div>
        )}
        {tab === "audience" && <AudienceReport sim={sim} />}
      </div>
    </div>
  );
}
