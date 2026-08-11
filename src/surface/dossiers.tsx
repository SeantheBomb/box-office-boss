// Dossiers: the cross-reference heart of BossOS. MovieDossier grows per phase;
// PersonDossier shows every known stat. Entity links open more dossier windows.

import type { Sim } from "../kernel/sim";
import type { Movie, Person } from "../kernel/types";
import { calDate, SEASONS } from "../kernel/types";
import { money } from "../kernel/text";
import { Portrait } from "./portraits";
import { FunnelReport } from "./reports";

export type OpenDossier = (kind: "movie" | "person", id: string) => void;

export function PersonLink({ sim, id, openDossier }: { sim: Sim; id?: string; openDossier: OpenDossier }) {
  const p = sim.person(id);
  if (!p) return <span>TBD</span>;
  return (
    <a class="doss-link" onClick={() => openDossier("person", p.id)}>
      {p.name}
    </a>
  );
}

export function MovieLink({ sim, id, openDossier }: { sim: Sim; id?: string; openDossier: OpenDossier }) {
  const m = sim.movie(id);
  if (!m) return <span>?</span>;
  return (
    <a class="doss-link" onClick={() => openDossier("movie", m.id)}>
      {m.title}
    </a>
  );
}

export function MovieDossier({ sim, movieId, openDossier, bump }: { sim: Sim; movieId: string; openDossier: OpenDossier; bump?: () => void }) {
  const m = sim.movie(movieId);
  if (!m) return <div class="doss">This project has been lost to studio archaeology.</div>;
  const P = sim.content.economy.pressTour;
  const canTour = m.studio === 0 && ["post", "release"].includes(m.phase) && m.pressTours < P.maxPerMovie;
  const phaseRank = ["pitch", "script", "development", "prepro", "production", "post", "release", "distribute", "done"].indexOf(m.phase);
  return (
    <div class="doss">
      <h3>
        {m.title} <span class="doss-phase">{m.phase.toUpperCase()}</span>
      </h3>
      <section>
        <h4>The Pitch</h4>
        <table>
          <tr><td>Genre</td><td>{m.genre} / {m.subgenre} · {m.estRating}</td></tr>
          {m.pitchLogline && <tr><td>Logline</td><td>"{m.pitchLogline}"</td></tr>}
          {m.franchise && <tr><td>Franchise</td><td>{m.franchise}</td></tr>}
          <tr><td>Written by</td><td><PersonLink sim={sim} id={m.writerId} openDossier={openDossier} /></td></tr>
          <tr><td>Min budget</td><td>{money(m.minBudget)}</td></tr>
          <tr><td>Projected BO</td><td>~{money(m.estRevenue ?? 0)}</td></tr>
          <tr><td>Target length</td><td>{m.targetLength} min · ~{m.actualVfx ?? m.estVfx} VFX shots{m.actualVfx ? " (actual)" : " (est)"}</td></tr>
        </table>
      </section>
      {phaseRank >= 1 && (
        <section>
          <h4>The Package</h4>
          <table>
            <tr><td>Director</td><td><PersonLink sim={sim} id={m.directorId ?? (m as any).idealDirectorId} openDossier={openDossier} />{!m.directorId && " (wanted)"}</td></tr>
            <tr>
              <td>Cast</td>
              <td>
                {(m.castIds.length ? m.castIds : m.idealCastIds).map((c, i) => (
                  <span key={c}>
                    {i > 0 && ", "}
                    <PersonLink sim={sim} id={c} openDossier={openDossier} />
                  </span>
                ))}
                {!m.castIds.length && " (proposed)"}
              </td>
            </tr>
            <tr><td>Producer</td><td>{m.producerId ? <PersonLink sim={sim} id={m.producerId} openDossier={openDossier} /> : m.phase === "development" ? "WAITING — parked in development" : "unassigned"}</td></tr>
            <tr><td>Script quality</td><td>{m.quality.script ? `${Math.round(m.quality.script)}/100` : "in progress"}</td></tr>
          </table>
        </section>
      )}
      {phaseRank >= 3 && <ProductionPlan sim={sim} m={m} openDossier={openDossier} />}
      {phaseRank >= 6 && (
        <section>
          <h4>Release</h4>
          <FunnelReport sim={sim} movie={m} />
          {m.reviews.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {m.reviews.slice(0, 3).map((r) => (
                <p key={r.criticId} style={{ fontSize: 12, marginBottom: 4 }}>
                  {r.stars}★ — {r.quote} <i>— <PersonLink sim={sim} id={r.criticId} openDossier={openDossier} /></i>
                </p>
              ))}
            </div>
          )}
        </section>
      )}
      <section>
        <h4>Money</h4>
        <table>
          <tr><td>Budget</td><td>{money(m.budget)}</td></tr>
          <tr><td>Spent so far</td><td>{money(m.spent)}{["prepro", "production", "post"].includes(m.phase) ? ` (+${money(m.dailyCost)}/day)` : ""}</td></tr>
          {m.revenue > 0 && <tr><td>Revenue</td><td>{money(m.revenue)}</td></tr>}
          <tr><td>Hype</td><td>{Math.round(m.hype)}/100{m.pressTours ? ` (${m.pressTours} press tour${m.pressTours > 1 ? "s" : ""})` : ""}</td></tr>
        </table>
        {canTour && bump && (
          <button
            class="doss-action"
            onClick={() => {
              const result = sim.pressTour(m.id);
              alert(result);
              bump();
            }}
          >
            🎤 Send the star on a press tour ({money(P.cost)} — hype +{P.hype}, star goodwill −{P.relationshipHit})
          </button>
        )}
      </section>
      {(m.incidents?.length ?? 0) > 0 && (
        <section>
          <h4>Incident Log</h4>
          {m.incidents.map((inc, i) => (
            <div key={i} class="incident">
              <div class="incident-head">
                ⚠ Day {inc.day} · {inc.kind.replace(/([A-Z])/g, " $1").toLowerCase()}
                {inc.cost > 0 && ` · ${money(inc.cost)}`}
                {inc.delay > 0 && ` · +${inc.delay}d`}
              </div>
              <div class="incident-text">{inc.text}</div>
              {inc.resolution && <div class="incident-res">↳ {inc.resolution}</div>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** Pre-production plan: shot-list gantt with per-block cast needs and availability blockouts. */
function ProductionPlan({ sim, m, openDossier }: { sim: Sim; m: Movie; openDossier: OpenDossier }) {
  const day = sim.state.day;
  const shotList = m.shotList ?? [];
  const totalDays = shotList.reduce((s, b) => s + b.days, 0) || 1;
  const prodStart = m.phase === "prepro" ? m.phaseEnd : m.phaseStart;
  const relEv = sim.state.events.find((e) => e.type === "release" && e.data.movieId === m.id);
  const relDay = m.releaseDay ?? relEv?.day;
  const people = [...new Set([m.directorId, ...m.castIds])].map((id) => sim.person(id)).filter(Boolean) as Person[];
  return (
    <section>
      <h4>Production Plan</h4>
      {shotList.length > 0 && (
        <div class="plan-gantt">
          {shotList.map((b, i) => {
            const offset = shotList.slice(0, i).reduce((s, x) => s + x.days, 0);
            return (
              <div class="plan-row" key={i}>
                <div class="plan-label">Location {b.location} ({b.days}d)</div>
                <div class="plan-track">
                  <div class="plan-bar" style={{ left: `${(offset / totalDays) * 100}%`, width: `${(b.days / totalDays) * 100}%` }}>
                    {b.castIds.map((c) => sim.person(c)?.name.split(" ")[0]).join(", ")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <table style={{ marginTop: 6 }}>
        <tr><td>Shoot window</td><td>day {prodStart} → {m.phase === "production" ? m.phaseEnd : prodStart + totalDays} (now: {day})</td></tr>
        {relDay !== undefined && (
          <tr><td>Est. release</td><td>{(() => { const d = calDate(relDay); return `WK ${d.week} ${SEASONS[d.season]} YR ${d.year}`; })()}</td></tr>
        )}
        <tr><td>Projected BO</td><td>~{money(m.estRevenue ?? 0)} vs budget {money(m.budget)}</td></tr>
        <tr><td>Market read</td><td>{(() => { const f = sim.state.audience.fads[m.genre] ?? 1; return f > 1.2 ? `${m.genre} is HOT (${f.toFixed(2)}×) — but watch for saturation` : f < 0.8 ? `${m.genre} is cold (${f.toFixed(2)}×) — contrarian play` : `${m.genre} steady (${f.toFixed(2)}×)`; })()}</td></tr>
      </table>
      <h4 style={{ marginTop: 8 }}>Talent Availability</h4>
      <table>
        {people.map((p) => {
          const conflicts = sim.state.movies.filter(
            (o) => o.id !== m.id && !["done", "cancelled"].includes(o.phase) && (o.castIds.includes(p.id) || o.directorId === p.id)
          );
          return (
            <tr key={p.id}>
              <td><PersonLink sim={sim} id={p.id} openDossier={openDossier} /></td>
              <td>
                {p.busyUntil > day ? `committed until day ${p.busyUntil}` : "free"}
                {conflicts.length > 0 && (
                  <span style={{ color: "#a33327" }}>
                    {" "}⚠ also on {conflicts.map((c, i) => (
                      <span key={c.id}>{i > 0 && ", "}<MovieLink sim={sim} id={c.id} openDossier={openDossier} /></span>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </table>
    </section>
  );
}

export function PersonDossier({ sim, personId, openDossier, bump }: { sim: Sim; personId: string; openDossier: OpenDossier; bump?: () => void }) {
  const p = sim.person(personId);
  if (!p) return <div class="doss">No file on this person. Suspicious.</div>;
  const lunchable = p.role !== "critic" && bump;
  const day = sim.state.day;
  const commitments = sim.state.movies.filter(
    (m) => !["done", "cancelled"].includes(m.phase) && (m.castIds.includes(p.id) || m.directorId === p.id || m.writerId === p.id || m.producerId === p.id)
  );
  const rel = p.relationship;
  const relStr = rel > 30 ? "adores you" : rel > 10 ? "warm" : rel > -10 ? "professional" : rel > -30 ? "wary" : "burned";
  return (
    <div class="doss">
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
        <Portrait seed={p.portraitSeed} size={84} role={p.role} mood={Math.sign(rel)} />
        <div>
          <h3 style={{ border: "none", margin: 0 }}>{p.name}</h3>
          <div style={{ fontSize: 12, color: "#666" }}>
            {p.role.toUpperCase()} · {p.archetype.replace(/-/g, " ")} · relationship: {relStr} ({rel > 0 ? "+" : ""}{Math.round(rel)})
          </div>
        </div>
      </div>
      <section>
        <h4>Stats</h4>
        <table>
          {p.role === "cast" && (
            <>
              <tr><td>Daily rate</td><td>{money(p.dailyRate ?? 0)}</td></tr>
              <tr><td>Cooperation</td><td>{p.cooperation}/100</td></tr>
              <tr><td>Improv</td><td>{p.improv}/100</td></tr>
              <tr><td>Fame</td><td>{p.fame}/100</td></tr>
              <tr><td>Physique</td><td>{p.physique}</td></tr>
              <tr><td>Net worth</td><td>{money(p.netWorth ?? 0)}</td></tr>
              <tr><td>Rider</td><td>"{p.rider}"</td></tr>
            </>
          )}
          {p.role === "director" && (
            <>
              <tr><td>Craft</td><td>{p.avgRating}/100</td></tr>
              <tr><td>Avg VFX shots</td><td>{p.avgVfxShots}</td></tr>
              <tr><td>Avg cast size</td><td>{p.avgCastSize}</td></tr>
              <tr><td>Avg locations</td><td>{p.avgLocations}</td></tr>
              <tr><td>Avg reshoots</td><td>{p.avgReshoots}</td></tr>
              <tr><td>Runs a set</td><td>{p.avgCastCooperation}/100 cast harmony</td></tr>
            </>
          )}
          {p.role === "writer" && (
            <>
              <tr><td>Craft</td><td>{p.avgRating}/100</td></tr>
              <tr><td>Genres</td><td>{p.capableGenres?.join(", ")}</td></tr>
            </>
          )}
          {p.role === "producer" && (
            <>
              <tr><td>Timelines</td><td>×{(p.avgProdLength ?? 1).toFixed(2)}</td></tr>
              <tr><td>Costs</td><td>×{(p.avgProdCost ?? 1).toFixed(2)}</td></tr>
              <tr><td>Revenue</td><td>×{(p.avgProdRevenue ?? 1).toFixed(2)}</td></tr>
              <tr><td>Craft</td><td>{p.avgRating}/100</td></tr>
              <tr><td>Load</td><td>{sim.producerLoad(p.id)} active project{sim.producerLoad(p.id) === 1 ? "" : "s"} (ideal ≤ {sim.content.economy.producers.idealLoad})</td></tr>
              <tr><td>Employer</td><td>{p.signedByStudio === 0 ? "YOUR studio" : "freelance"}</td></tr>
            </>
          )}
          {p.role === "critic" && (
            <>
              <tr><td>Outlet</td><td>{p.outlet}</td></tr>
              <tr><td>Harshness</td><td>{Math.round((p.harshness ?? 0) * 100)}/100</td></tr>
              <tr><td>Soft spots</td><td>{Object.entries(p.genreBias ?? {}).filter(([, v]) => (v as number) > 0.3).map(([g]) => g).join(", ") || "none known"}</td></tr>
            </>
          )}
          <tr><td>Status</td><td>{p.busyUntil > day ? `committed until day ${p.busyUntil}` : "available"}</td></tr>
          {p.agentId && <tr><td>Repped by</td><td><PersonLink sim={sim} id={p.agentId} openDossier={openDossier} /></td></tr>}
        </table>
        {lunchable && (
          <button
            class="doss-action"
            onClick={() => {
              const ok = sim.requestLunch(p.id);
              alert(ok ? `Lunch with ${p.name} is on the calendar. Deals happen at lunch.` : "A lunch is already booked (or they're dodging your calls).");
              bump!();
            }}
          >
            🍽 Take {p.name.split(" ")[0]} to lunch (books a calendar slot — relationships are played, not wished for)
          </button>
        )}
      </section>
      {commitments.length > 0 && (
        <section>
          <h4>Current Commitments</h4>
          <table>
            {commitments.map((m) => (
              <tr key={m.id}>
                <td><MovieLink sim={sim} id={m.id} openDossier={openDossier} /></td>
                <td>{m.phase}{sim.state.studios[m.studio].isPlayer ? "" : ` (${sim.state.studios[m.studio].name})`}</td>
              </tr>
            ))}
          </table>
        </section>
      )}
      {p.filmography.length > 0 && (
        <section>
          <h4>Filmography</h4>
          <table>
            {p.filmography.slice(-8).reverse().map((f) => (
              <tr key={f.movieId}>
                <td>{f.title}</td>
                <td>YR {f.year}</td>
                <td>{f.stars.toFixed(1)}★</td>
                <td style={{ color: f.profit >= 0 ? "#3f6d3a" : "#a33327" }}>{f.profit >= 0 ? "hit" : "flop"}</td>
              </tr>
            ))}
          </table>
        </section>
      )}
    </div>
  );
}
