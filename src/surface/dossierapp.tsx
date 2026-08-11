// The Dossier: one searchable app for every file in the game — people, pictures,
// studios, VFX houses. Every entity link in BossOS routes here; browse tabs cover
// what search can't spell, and the back-trail retraces the rabbit hole.

import { useEffect, useRef, useState } from "preact/hooks";
import type { Sim } from "../kernel/sim";
import type { Person } from "../kernel/types";
import { money } from "../kernel/text";
import { MovieDossier, PersonDossier, StudioDossier, VfxDossier, roleGlyph, type DossierKind, type OpenDossier } from "./dossiers";
import { Portrait2 } from "./portraits2";
import { audio } from "./audio";

type Tab = "files" | "people" | "pictures" | "studios" | "vfx";

const ROLE_CHIPS: [string, string][] = [
  ["producer", "🎬 Producers"],
  ["director", "🎥 Directors"],
  ["writer", "✍ Writers"],
  ["cast", "⭐ Cast"],
  ["agent", "🕶 Agents"],
  ["critic", "📰 Critics"],
];

export function DossierApp({
  sim,
  kind,
  id,
  openDossier,
  bump,
}: {
  sim: Sim;
  kind?: DossierKind;
  id?: string;
  openDossier: OpenDossier;
  bump: () => void;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("files");
  const historyRef = useRef<{ kind: DossierKind; id: string }[]>([]);
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
    const prev = h.pop(); // previous (re-pushed by the effect)
    if (prev) openDossier(prev.kind, prev.id);
  };

  const open = (k: DossierKind, i: string) => {
    audio.sfx("click", 0.4);
    setQuery("");
    openDossier(k, i);
  };

  const q = query.trim().toLowerCase();
  const roleMatch = (p: Person) => p.role.includes(q.replace(/s$/, "")) || p.archetype.includes(q);
  const results =
    q.length >= 2
      ? [
          ...sim.state.people
            .filter((p) => p.name.toLowerCase().includes(q) || roleMatch(p))
            .slice(0, 12)
            .map((p) => ({ kind: "person" as DossierKind, id: p.id, label: p.name, sub: `${p.role} · ${p.archetype.replace(/-/g, " ")}`, person: p as Person | undefined })),
          ...sim.state.movies
            .filter(
              (m) =>
                m.title.toLowerCase().includes(q) ||
                m.genre.toLowerCase().includes(q) ||
                (m.genre2 ?? "").toLowerCase().includes(q) ||
                (m.topic ?? "").includes(q) ||
                sim.state.studios[m.studio]?.name.toLowerCase().includes(q)
            )
            .slice(0, 12)
            .map((m) => ({
              kind: "movie" as DossierKind,
              id: m.id,
              label: m.title,
              sub: `${sim.fusion(m)} · ${m.phase.toUpperCase()}${m.studio !== 0 ? ` · ${sim.state.studios[m.studio]?.name}` : ""}`,
              person: undefined,
            })),
          ...sim.state.studios
            .map((s, i) => ({ s, i }))
            .filter(({ s }) => s.name.toLowerCase().includes(q) || "studio".includes(q))
            .map(({ s, i }) => ({
              kind: "studio" as DossierKind,
              id: String(i),
              label: s.name,
              sub: s.isPlayer ? "YOUR studio" : s.bankrupt ? "bankrupt" : "rival studio",
              person: undefined,
            })),
          ...sim.state.vfxStudios
            .filter((v) => v.name.toLowerCase().includes(q) || "vfx".includes(q))
            .slice(0, 8)
            .map((v) => ({ kind: "vfx" as DossierKind, id: v.id, label: v.name, sub: `VFX house · ${money(v.dailyCost)}/day · rep ${v.avgRating}/100`, person: undefined })),
        ]
      : [];

  const showingFile = !q && kind && id;
  return (
    <div class="dossier-app">
      <div class="dossier-toolbar">
        {historyRef.current.length > 1 && (
          <button class="doss-back" title="Back" onClick={() => { audio.sfx("click", 0.4); goBack(); }}>‹</button>
        )}
        <input
          placeholder="Search anyone or anything — people, pictures, studios, genres, topics…"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </div>
      {q.length >= 2 ? (
        <div class="dossier-results">
          {results.map((r) => (
            <div key={`${r.kind}:${r.id}`} class="dossier-result" onClick={() => open(r.kind, r.id)}>
              {r.person ? <Portrait2 person={r.person} size={36} /> : <span class="dossier-film">{r.kind === "movie" ? "🎞" : r.kind === "studio" ? "🏛" : "🎇"}</span>}
              <span>
                <b>{r.label}</b>
                <i>{r.sub}</i>
              </span>
            </div>
          ))}
          {!results.length && <p class="dossier-none">Nothing in the files. The town keeps secrets, but not that one — try another spelling.</p>}
        </div>
      ) : showingFile ? (
        <div class="report-sheet windowed">
          {kind === "movie" ? (
            <MovieDossier sim={sim} movieId={id!} openDossier={openDossier} bump={bump} />
          ) : kind === "person" ? (
            <PersonDossier sim={sim} personId={id!} openDossier={openDossier} bump={bump} />
          ) : kind === "studio" ? (
            <StudioDossier sim={sim} studioIndex={Number(id)} openDossier={openDossier} />
          ) : (
            <VfxDossier sim={sim} vfxId={id!} openDossier={openDossier} />
          )}
        </div>
      ) : (
        <>
          <div class="dossier-tabs">
            {(
              [
                ["files", "🗂 Files"],
                ["people", "👤 People"],
                ["pictures", "🎞 Pictures"],
                ["studios", "🏛 Studios"],
                ["vfx", "🎇 VFX"],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} class={tab === t ? "on" : ""} onClick={() => { audio.sfx("click", 0.3); setTab(t); }}>
                {label}
              </button>
            ))}
          </div>
          <div class="report-sheet windowed">
            {tab === "files" && <DossierHome sim={sim} openDossier={open} />}
            {tab === "people" && <PeopleShelf sim={sim} openDossier={open} />}
            {tab === "pictures" && <PicturesShelf sim={sim} openDossier={open} />}
            {tab === "studios" && <StudiosShelf sim={sim} openDossier={open} />}
            {tab === "vfx" && <VfxShelf sim={sim} openDossier={open} />}
          </div>
        </>
      )}
    </div>
  );
}

function DossierHome({ sim, openDossier }: { sim: Sim; openDossier: OpenDossier }) {
  const staff = sim.staffProducers();
  const slate = sim.state.movies.filter((m) => m.studio === 0 && !["done", "cancelled"].includes(m.phase));
  const hot = sim.state.people.filter((p) => (p.role === "cast" || p.role === "director") && p.busyUntil <= sim.state.day).slice(0, 6);
  return (
    <div>
      <h3>The Files</h3>
      <p style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>Search above, browse the tabs, or start from a shelf:</p>
      <h4 style={{ fontVariant: "small-caps" }}>Your Slate</h4>
      {slate.map((m) => (
        <p key={m.id} style={{ fontSize: 13 }}>
          <a class="doss-link" onClick={() => openDossier("movie", m.id)}>🎞 {m.title}</a> — {m.phase} · {money(m.budget)}
        </p>
      ))}
      <h4 style={{ fontVariant: "small-caps", marginTop: 10 }}>Your Producers</h4>
      {staff.map((p) => (
        <p key={p.id} style={{ fontSize: 13 }}>
          <a class="doss-link" onClick={() => openDossier("person", p.id)}>{roleGlyph(p)} {p.name}</a> — {sim.producerLoad(p.id)} active
          {p.morale !== undefined && p.morale < 45 ? " · 👀 restless" : ""}
        </p>
      ))}
      <h4 style={{ fontVariant: "small-caps", marginTop: 10 }}>Available Talent</h4>
      {hot.map((p) => (
        <p key={p.id} style={{ fontSize: 13 }}>
          <a class="doss-link" onClick={() => openDossier("person", p.id)}>{roleGlyph(p)} {p.name}</a> — {p.role}
        </p>
      ))}
    </div>
  );
}

function PeopleShelf({ sim, openDossier }: { sim: Sim; openDossier: OpenDossier }) {
  const [role, setRole] = useState("producer");
  const people = sim.state.people.filter((p) => p.role === role);
  const stat = (p: Person) =>
    p.role === "cast" ? `fame ${p.fame}/100 · ${money(p.dailyRate ?? 0)}/day` :
    p.role === "producer" ? `craft ${p.avgRating}/100 · ${p.signedByStudio === undefined ? "freelance" : p.signedByStudio === 0 ? "YOURS" : sim.state.studios[p.signedByStudio]?.name}` :
    p.role === "critic" ? `${p.outlet}` :
    `craft ${p.avgRating ?? "?"}/100`;
  return (
    <div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
        {ROLE_CHIPS.map(([r, label]) => (
          <button key={r} class={`doss-chip ${role === r ? "on" : ""}`} onClick={() => setRole(r)}>{label}</button>
        ))}
      </div>
      {people.map((p) => (
        <p key={p.id} style={{ fontSize: 13 }}>
          <a class="doss-link" onClick={() => openDossier("person", p.id)}>{roleGlyph(p)} {p.name}</a>
          <span style={{ color: "#666", fontSize: 11 }}> — {stat(p)}</span>
        </p>
      ))}
    </div>
  );
}

function PicturesShelf({ sim, openDossier }: { sim: Sim; openDossier: OpenDossier }) {
  const groups = sim.state.studios.map((s, i) => ({
    s,
    i,
    movies: sim.state.movies.filter((m) => m.studio === i && m.phase !== "cancelled").slice(-10).reverse(),
  }));
  return (
    <div>
      {groups.map(({ s, i, movies }) => (
        <div key={i}>
          <h4 style={{ fontVariant: "small-caps", marginTop: i === 0 ? 0 : 10 }}>
            <a class="doss-link" onClick={() => openDossier("studio", String(i))}>🏛 {s.name}</a>
            {s.isPlayer ? " (you)" : s.bankrupt ? " (bankrupt)" : ""}
          </h4>
          {movies.map((m) => (
            <p key={m.id} style={{ fontSize: 13 }}>
              <a class="doss-link" onClick={() => openDossier("movie", m.id)}>🎞 {m.title}</a>
              <span style={{ color: "#666", fontSize: 11 }}> — {sim.fusion(m)} · {m.phase}</span>
            </p>
          ))}
          {!movies.length && <p style={{ fontSize: 12, color: "#999" }}>nothing on the slate</p>}
        </div>
      ))}
    </div>
  );
}

function StudiosShelf({ sim, openDossier }: { sim: Sim; openDossier: OpenDossier }) {
  return (
    <div>
      {sim.state.studios.map((s, i) => (
        <p key={i} style={{ fontSize: 13 }}>
          <a class="doss-link" onClick={() => openDossier("studio", String(i))}>🏛 {s.name}</a>
          <span style={{ color: "#666", fontSize: 11 }}>
            {" "}— {s.isPlayer ? "your studio" : s.bankrupt ? "bankrupt" : s.persona ?? "rival"} · reported {money(s.totalRevenue - s.reportedSpend)}
          </span>
        </p>
      ))}
    </div>
  );
}

function VfxShelf({ sim, openDossier }: { sim: Sim; openDossier: OpenDossier }) {
  return (
    <div>
      {sim.state.vfxStudios.map((v) => (
        <p key={v.id} style={{ fontSize: 13 }}>
          <a class="doss-link" onClick={() => openDossier("vfx", v.id)}>🎇 {v.name}</a>
          <span style={{ color: "#666", fontSize: 11 }}> — {money(v.dailyCost)}/day · ~{v.maxDailyShots} shots/day · rep {v.avgRating}/100</span>
        </p>
      ))}
    </div>
  );
}
