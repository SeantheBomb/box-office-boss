// The Dossier: one searchable app for every file in the game. Every entity link in
// BossOS routes here — search anything, open its file, walk the back-trail.

import { useEffect, useRef, useState } from "preact/hooks";
import type { Sim } from "../kernel/sim";
import { money } from "../kernel/text";
import { MovieDossier, PersonDossier, type OpenDossier } from "./dossiers";
import { Portrait2 } from "./portraits2";
import { audio } from "./audio";

export function DossierApp({
  sim,
  kind,
  id,
  openDossier,
  bump,
}: {
  sim: Sim;
  kind?: "movie" | "person";
  id?: string;
  openDossier: OpenDossier;
  bump: () => void;
}) {
  const [query, setQuery] = useState("");
  const historyRef = useRef<{ kind: "movie" | "person"; id: string }[]>([]);
  // the back-trail: every file visited this session
  useEffect(() => {
    if (!kind || !id) return;
    const h = historyRef.current;
    if (h.length && h[h.length - 1].kind === kind && h[h.length - 1].id === id) return;
    h.push({ kind, id });
    if (h.length > 20) h.shift();
  }, [kind, id]);

  const goBack = () => {
    const h = historyRef.current;
    h.pop(); // current
    const prev = h.pop(); // previous (will be re-pushed by the effect)
    if (prev) openDossier(prev.kind, prev.id);
  };

  const q = query.trim().toLowerCase();
  const results =
    q.length >= 2
      ? [
          ...sim.state.people
            .filter((p) => p.name.toLowerCase().includes(q) || p.role.includes(q) || p.archetype.includes(q))
            .slice(0, 10)
            .map((p) => ({ kind: "person" as const, id: p.id, label: p.name, sub: `${p.role} · ${p.archetype.replace(/-/g, " ")}`, person: p })),
          ...sim.state.movies
            .filter((m) => m.title.toLowerCase().includes(q) || m.genre.toLowerCase().includes(q) || (m.topic ?? "").includes(q) || (m.genre2 ?? "").toLowerCase().includes(q))
            .slice(0, 10)
            .map((m) => ({
              kind: "movie" as const,
              id: m.id,
              label: m.title,
              sub: `${sim.fusion(m)} · ${m.phase.toUpperCase()}${m.studio !== 0 ? ` · ${sim.state.studios[m.studio]?.name}` : ""}`,
              person: undefined,
            })),
        ]
      : [];

  return (
    <div class="dossier-app">
      <div class="dossier-toolbar">
        {historyRef.current.length > 1 && (
          <button class="doss-back" title="Back" onClick={() => { audio.sfx("click", 0.4); goBack(); }}>‹</button>
        )}
        <input
          placeholder="Search anyone or anything — people, pictures, genres, topics…"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </div>
      {q.length >= 2 ? (
        <div class="dossier-results">
          {results.map((r) => (
            <div
              key={r.id}
              class="dossier-result"
              onClick={() => {
                audio.sfx("click", 0.4);
                setQuery("");
                openDossier(r.kind, r.id);
              }}
            >
              {r.person ? <Portrait2 person={r.person} size={36} /> : <span class="dossier-film">🎞</span>}
              <span>
                <b>{r.label}</b>
                <i>{r.sub}</i>
              </span>
            </div>
          ))}
          {!results.length && <p class="dossier-none">Nothing in the files. The town keeps secrets, but not that one — try another spelling.</p>}
        </div>
      ) : kind === "movie" && id ? (
        <div class="report-sheet windowed">
          <MovieDossier sim={sim} movieId={id} openDossier={openDossier} bump={bump} />
        </div>
      ) : kind === "person" && id ? (
        <div class="report-sheet windowed">
          <PersonDossier sim={sim} personId={id} openDossier={openDossier} bump={bump} />
        </div>
      ) : (
        <DossierHome sim={sim} openDossier={openDossier} />
      )}
    </div>
  );
}

function DossierHome({ sim, openDossier }: { sim: Sim; openDossier: OpenDossier }) {
  const staff = sim.staffProducers();
  const slate = sim.state.movies.filter((m) => m.studio === 0 && !["done", "cancelled"].includes(m.phase));
  const hot = sim.state.people.filter((p) => (p.role === "cast" || p.role === "director") && p.busyUntil <= sim.state.day).slice(0, 6);
  return (
    <div class="report-sheet windowed">
      <h3>The Files</h3>
      <p style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>Search above, or start from a shelf:</p>
      <h4 style={{ fontVariant: "small-caps" }}>Your Slate</h4>
      {slate.map((m) => (
        <p key={m.id} style={{ fontSize: 13 }}>
          <a class="doss-link" onClick={() => openDossier("movie", m.id)}>🎞 {m.title}</a> — {m.phase} · {money(m.budget)}
        </p>
      ))}
      <h4 style={{ fontVariant: "small-caps", marginTop: 10 }}>Your Producers</h4>
      {staff.map((p) => (
        <p key={p.id} style={{ fontSize: 13 }}>
          <a class="doss-link" onClick={() => openDossier("person", p.id)}>👤 {p.name}</a> — {sim.producerLoad(p.id)} active
        </p>
      ))}
      <h4 style={{ fontVariant: "small-caps", marginTop: 10 }}>Available Talent</h4>
      {hot.map((p) => (
        <p key={p.id} style={{ fontSize: 13 }}>
          <a class="doss-link" onClick={() => openDossier("person", p.id)}>👤 {p.name}</a> — {p.role}
        </p>
      ))}
    </div>
  );
}
