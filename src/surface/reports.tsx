// Report components: standings line chart, release funnel, production board Gantt, audience report.

import type { Sim } from "../kernel/sim";
import type { Movie } from "../kernel/types";
import { money, count } from "../kernel/text";
import { calDate, SEASONS } from "../kernel/types";
import type { FunnelResult } from "../kernel/audience";

const LINE_COLORS = ["#c9a227", "#a33327", "#2e5266", "#3f6d3a", "#6d3a5d", "#8a5a2c"];

export function StandingsChart({ sim, compact }: { sim: Sim; compact?: boolean }) {
  const studios = sim.state.studios;
  const W = compact ? 560 : 860;
  const H = compact ? 200 : 300;
  const pad = 46;
  const maxWeeks = Math.max(2, ...studios.map((s) => s.history.length));
  let min = 0, max = 1;
  for (const s of studios) for (const h of s.history) { min = Math.min(min, h.profit); max = Math.max(max, h.profit); }
  const span = Math.max(1, max - min);
  const x = (i: number) => pad + (i / Math.max(1, maxWeeks - 1)) * (W - pad - 10);
  const y = (p: number) => H - 24 - ((p - min) / span) * (H - 40);
  const reported = (s: (typeof studios)[0]) => s.totalRevenue - s.reportedSpend;
  const ranked = [...studios].sort((a, b) => reported(b) - reported(a));
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: "#faf6ec", border: "1px solid #d8d0bc" }}>
        <line x1={pad} y1={y(0)} x2={W - 8} y2={y(0)} stroke="#999" stroke-dasharray="4 3" />
        <text x={6} y={y(0) + 4} font-size="10" fill="#666">$0</text>
        <text x={6} y={16} font-size="10" fill="#666">{money(max)}</text>
        <text x={6} y={H - 28} font-size="10" fill="#666">{money(min)}</text>
        {studios.map((s, si) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={LINE_COLORS[si % LINE_COLORS.length]}
            stroke-width={s.isPlayer ? 3 : 1.6}
            opacity={s.isPlayer ? 1 : 0.75}
            points={s.history.map((h, i) => `${x(i)},${y(h.profit)}`).join(" ")}
          />
        ))}
        {/* release markers for the player */}
        {sim.state.movies.filter((m) => m.studio === 0 && m.releaseDay !== undefined).map((m) => {
          const wk = Math.floor((m.releaseDay ?? 0) / 7);
          return <g key={m.id}>
            <line x1={x(wk)} y1={16} x2={x(wk)} y2={H - 24} stroke="#c9a22766" />
            <text x={x(wk) + 2} y={24} font-size="8" fill="#8a6a10">{m.title.slice(0, 14)}</text>
          </g>;
        })}
      </svg>
      <table>
        <tbody>
          {ranked.map((s) => {
            const si = studios.indexOf(s);
            return (
              <tr key={s.name} style={s.bankrupt ? { opacity: 0.45, textDecoration: "line-through" } : undefined}>
                <td style={{ color: LINE_COLORS[si % LINE_COLORS.length], fontWeight: "bold" }}>#{ranked.indexOf(s) + 1}</td>
                <td>{s.name}{s.isPlayer ? " (you)" : ""}{s.bankrupt ? " †" : ""}</td>
                <td>{money(reported(s))}</td>
                <td>{s.isPlayer ? `${money(s.cash)} cash (private)` : "books sealed"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** This week at the box office: every picture in theaters, ranked by weekend gross. */
export function WeekChart({ sim, openDossier }: { sim: Sim; openDossier?: (kind: "movie" | "person", id: string) => void }) {
  const chart = sim.state.weekChart ?? [];
  if (!chart.length) return <p style={{ color: "#666", fontSize: 12 }}>Nothing in theaters this week. The popcorn goes stale citywide.</p>;
  return (
    <table>
      <thead>
        <tr><th>#</th><th>Picture</th><th>Studio</th><th>Weekend</th><th>Total</th><th>Wk</th></tr>
      </thead>
      <tbody>
        {chart.map((row, i) => {
          const m = sim.movie(row.movieId);
          if (!m) return null;
          const wk = Math.floor((sim.state.day - (m.releaseDay ?? 0)) / 7);
          const mine = m.studio === 0;
          return (
            <tr key={row.movieId} style={mine ? { background: "#fdf3d0", fontWeight: "bold" } : undefined}>
              <td>{i + 1}</td>
              <td style={openDossier ? { cursor: "pointer", textDecoration: "underline" } : undefined} onClick={() => openDossier?.("movie", m.id)}>{m.title}</td>
              <td>{sim.state.studios[m.studio].name.split(" ")[0]}{mine ? " ★" : ""}</td>
              <td>{money(row.gross)}</td>
              <td>{money(m.weeklyGross.reduce((a, b) => a + b, 0))}</td>
              <td>{wk + 1}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function MandateBoard({ sim }: { sim: Sim }) {
  const active = sim.state.mandates.filter((md) => !md.done && !md.failed);
  const closed = sim.state.mandates.filter((md) => md.done || md.failed).slice(-3);
  if (!active.length && !closed.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <h3>Board Notes</h3>
      {active.map((md) => {
        const d = calDate(md.deadlineDay);
        return <p key={md.id} style={{ fontSize: 13 }}>📌 "{md.text}" — due WK {d.week} YR {d.year}</p>;
      })}
      {closed.map((md) => (
        <p key={md.id} style={{ fontSize: 12, opacity: 0.6, textDecoration: md.failed ? "line-through" : "none" }}>
          {md.failed ? "✖" : "✔"} {md.text}
        </p>
      ))}
    </div>
  );
}

export function FunnelReport({ sim, movie }: { sim: Sim; movie: Movie }) {
  const funnel = sim.state.flags[`funnel_${movie.id}`] as FunnelResult | undefined;
  if (!funnel) return <div>No release data yet for {movie.title}.</div>;
  const stars = movie.reviews.length ? (movie.reviews.reduce((s, r) => s + r.stars, 0) / movie.reviews.length).toFixed(1) : "—";
  const rows: [string, number, string][] = [
    ["Existing fans", funnel.fans, "franchise + star power"],
    ["Audience reached", funnel.reached, `marketing ${money(movie.marketing)} × hype ${Math.round(movie.hype)}`],
    ["Audience interested", funnel.interested, `taste match × ${stars}★ reviews × fan score ${Math.round(movie.fanScore ?? 0)}`],
    ["Bought tickets (wk 1)", funnel.tickets, `${movie.theaters} theaters, ${SEASONS[calDate(movie.releaseDay ?? 0).season]} release`],
    ["Wholesale units", funnel.wholesale, "home-video channel preference"],
    ["Retail units", funnel.retail, "long tail"],
  ];
  const maxV = Math.max(...rows.map((r) => r[1]), 0.001);
  const net = movie.revenue - movie.budget;
  return (
    <div>
      <h3>{movie.title} — Release Funnel</h3>
      {rows.map(([label, v, why]) => (
        <div class="funnel-row" key={label}>
          <div>{label}</div>
          <div class="funnel-bar" style={{ width: `${Math.max(3, (v / maxV) * 100)}%` }}>{count(v * 1e6)}</div>
          <div style={{ fontSize: 11, color: "#666" }}>{why}</div>
        </div>
      ))}
      <p style={{ marginTop: 10 }}>
        Revenue to date <b>{money(movie.revenue)}</b> vs budget <b>{money(movie.budget)}</b> →{" "}
        <b style={{ color: net >= 0 ? "#3f6d3a" : "#a33327" }}>{net >= 0 ? "profit" : "loss"} {money(Math.abs(net))}</b>
      </p>
    </div>
  );
}

const PHASE_COLORS: Record<string, string> = {
  script: "#8a8a5a", development: "#666", prepro: "#8a5a2c", production: "#a33327", post: "#2e5266", release: "#c9a227", distribute: "#3f6d3a",
};

export function ProductionBoard({ sim, openDossier }: { sim: Sim; openDossier?: (kind: "movie" | "person", id: string) => void }) {
  const day = sim.state.day;
  const movies = sim.state.movies.filter((m) => m.studio === 0 && !["done", "cancelled"].includes(m.phase));
  const horizon0 = day - 28;
  const horizon1 = day + 180;
  const span = horizon1 - horizon0;
  const px = (d: number) => `${Math.max(0, Math.min(100, ((d - horizon0) / span) * 100))}%`;
  const releaseEv = (m: Movie) => sim.state.events.find((e) => e.type === "release" && e.data.movieId === m.id);
  return (
    <div>
      <h3>Production Board</h3>
      {!movies.length && <p>Nothing in the pipeline. The soundstage echoes. Take a pitch meeting.</p>}
      {movies.map((m) => {
        const rel = m.releaseDay ?? releaseEv(m)?.day;
        return (
          <div class="gantt-row" key={m.id}>
            <div>
              <b style={openDossier ? { cursor: "pointer", textDecoration: "underline" } : undefined} onClick={() => openDossier?.("movie", m.id)}>{m.title}</b>
              <div style={{ color: "#666" }}>
                {m.genre} · {money(m.budget)}
                {m.producerId ? ` · ${sim.person(m.producerId)?.name.split(" ")[0]}` : m.phase === "development" ? " · NEEDS PRODUCER" : ""}
                {m.setbackCount ? ` · ⚠${m.setbackCount}` : ""}
              </div>
            </div>
            <div class="gantt-track">
              <div class="gantt-bar" style={{ left: px(m.phaseStart), width: `calc(${px(Math.max(m.phaseEnd, m.phaseStart + 4))} - ${px(m.phaseStart)})`, background: PHASE_COLORS[m.phase] ?? "#777" }}>
                {m.phase.toUpperCase()}
              </div>
              {rel !== undefined && <div class="gantt-bar" style={{ left: px(rel), width: 14, background: "#c9a227" }} title="release">◆</div>}
              <div class="gantt-now" style={{ left: px(day) }} />
            </div>
            <div style={{ fontSize: 11 }}>{m.phase === "release" || m.phase === "distribute" ? money(m.revenue) : `-${money(m.spent)}`}</div>
          </div>
        );
      })}
      <h3 style={{ marginTop: 16 }}>Talent Commitments</h3>
      <table>
        <tbody>
          {sim.state.people
            .filter((p) => (p.role === "cast" || p.role === "director") && p.busyUntil > day)
            .slice(0, 12)
            .map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.role}</td>
                <td>{p.signedByStudio !== undefined ? sim.state.studios[p.signedByStudio]?.name : "busy"}</td>
                <td>free in {p.busyUntil - day}d</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export function AudienceReport({ sim }: { sim: Sim }) {
  const segs = sim.state.audience.segments;
  const fads = Object.entries(sim.state.audience.fads).sort((a, b) => b[1] - a[1]);
  const genres = Object.keys(sim.content.pitches.genres);
  return (
    <div>
      <h3>Audience Report</h3>
      <table class="seg-grid">
        <thead>
          <tr><th>Segment</th><th>Size</th>{genres.map((g) => <th key={g}>{g.slice(0, 6)}</th>)}</tr>
        </thead>
        <tbody>
          {segs.map((s) => (
            <tr key={s.id}>
              <td><b>{s.name}</b></td>
              <td>{s.size}M</td>
              {genres.map((g) => {
                const pref = s.genres[g] ?? "unknown";
                return <td key={g} class={pref}>{pref === "unknown" ? "?????" : pref.toUpperCase()}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ marginTop: 14 }}>Fad Tracker</h3>
      <table>
        <tbody>
          {fads.map(([g, v]) => {
            const inProd = sim.state.movies.filter((m) => m.genre === g && ["production", "post", "prepro", "script"].includes(m.phase)).length;
            return (
              <tr key={g}>
                <td>{g}</td>
                <td>{v > 1.25 ? "▲▲ hot" : v > 1.08 ? "▲ warm" : v < 0.8 ? "▼ cold" : "— steady"}</td>
                <td>{"█".repeat(Math.round(v * 6))}</td>
                <td style={{ fontSize: 11, color: "#666" }}>{inProd ? `${inProd} in production across town${v > 1.2 ? " — saturation risk" : ""}` : "field is open"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ marginTop: 8, fontSize: 11, color: "#666" }}>?????: undiscovered — someone has to release one (anyone's) to learn how a segment really feels.</p>
    </div>
  );
}
