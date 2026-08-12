// Hidden editor (Ctrl+Shift+E). Fully-procedural game => the editor edits GENERATORS
// and TEMPLATES (content/*.json), never world instances. Draft overlay in localStorage,
// publish to Cloudflare KV via /api/content.

import { useEffect, useMemo, useState } from "preact/hooks";
import { FILES, type ContentFile, assemble, loadDraft, saveDraft, clearDraft, fetchPublished } from "../data/content";
import { Sim } from "../kernel/sim";
import { autoplay, disciplinedEmailPolicy, disciplinedMeetingPolicy, stateHash } from "../kernel/autopilot";
import { newSeededRun } from "../kernel/preseed";
import { makeRng } from "../kernel/rng";
import { mintWorld } from "../kernel/people";
import { mintPitch } from "../kernel/pitchgen";
import { money } from "../kernel/text";
import { Portrait2 } from "../surface/portraits2";
import { DAYS_PER_YEAR, calDate } from "../kernel/types";
import { replaySession, checkDrift, type DecisionContext, type SessionSnapshot } from "../kernel/replay";

type Tab = ContentFile | "preview" | "simlab" | "publish" | "sessions";

export function Editor({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("people");
  const [draft, setDraft] = useState(() => loadDraft());
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string>("");

  const currentText = (f: ContentFile) => texts[f] ?? JSON.stringify(draft[f] ?? (assemble(undefined, {}) as any)[f], null, 2);

  const saveFileDraft = (f: ContentFile) => {
    try {
      const parsed = JSON.parse(currentText(f));
      const next = { ...draft, [f]: parsed };
      setDraft(next);
      saveDraft(next);
      setErr(`✔ ${f}.json draft saved. New runs (and reload) use it.`);
    } catch (e) {
      setErr(`JSON error in ${f}.json:\n${e}`);
    }
  };

  return (
    <div class="editor">
      <header>
        <b style={{ marginRight: 8 }}>🎬 BOB Editor</b>
        {FILES.map((f) => (
          <button key={f} class={tab === f ? "on" : ""} onClick={() => { setTab(f); setErr(""); }}>
            {f}{draft[f] ? "*" : ""}
          </button>
        ))}
        <button class={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>🎲 preview</button>
        <button class={tab === "simlab" ? "on" : ""} onClick={() => setTab("simlab")}>🧪 sim lab</button>
        <button class={tab === "publish" ? "on" : ""} onClick={() => setTab("publish")}>☁ publish</button>
        <button class={tab === "sessions" ? "on" : ""} onClick={() => setTab("sessions")}>🎥 sessions</button>
        <div class="right">
          <button
            onClick={() => {
              if (confirm("Clear ALL local content drafts?")) {
                clearDraft();
                setDraft({});
                setTexts({});
              }
            }}
          >
            reset drafts
          </button>
          <button onClick={onClose}>✕ close</button>
        </div>
      </header>
      <div class="body">
        {FILES.includes(tab as ContentFile) && (
          <>
            <textarea
              value={currentText(tab as ContentFile)}
              onInput={(e) => setTexts({ ...texts, [tab]: (e.target as HTMLTextAreaElement).value })}
              spellcheck={false}
            />
            <div class="side">
              <h4>{tab}.json</h4>
              <button onClick={() => saveFileDraft(tab as ContentFile)}>💾 save draft</button>
              <button
                onClick={() => {
                  const next = { ...draft };
                  delete next[tab as ContentFile];
                  setDraft(next);
                  saveDraft(next);
                  const t = { ...texts };
                  delete t[tab];
                  setTexts(t);
                  setErr(`${tab}.json draft cleared — back to bundled/published.`);
                }}
              >
                ↩ revert
              </button>
              <p class="err">{err}</p>
              <p style={{ marginTop: 10, opacity: 0.7 }}>
                Drafts overlay bundled + published content (deep-merged, so partial files are fine). A running game keeps its
                world — content changes shape <i>new</i> emails, meetings, and newly minted runs.
              </p>
            </div>
          </>
        )}
        {tab === "preview" && <PreviewTab draft={draft} />}
        {tab === "simlab" && <SimLabTab draft={draft} />}
        {tab === "publish" && <PublishTab draft={draft} setDraft={(d) => { setDraft(d); saveDraft(d); }} />}
        {tab === "sessions" && <SessionsTab />}
      </div>
    </div>
  );
}

function PreviewTab({ draft }: { draft: any }) {
  const [seed, setSeed] = useState(7);
  const content = useMemo(() => assemble(undefined, draft), [draft, seed]);
  const world = useMemo(() => mintWorld(makeRng(seed), content), [content, seed]);
  const pitches = useMemo(() => {
    const rng = makeRng(seed ^ 0x9e37);
    const sim = Sim.newRun(content, seed);
    const writers = sim.state.people.filter((p) => p.role === "writer");
    return Array.from({ length: 8 }, (_, i) => mintPitch(rng, content, sim.state, writers[i % writers.length], 0));
  }, [content, seed]);
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        seed <input type="number" value={seed} onInput={(e) => setSeed(parseInt((e.target as HTMLInputElement).value) || 0)} style={{ width: 90 }} />
        <button class="runbtn" onClick={() => setSeed(Math.floor(Math.random() * 100000))}>reroll</button>
      </div>
      <h4>Minted people (from people.json generators)</h4>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {world.people.slice(0, 24).map((p) => (
          <div class="preview-card" key={p.id} style={{ width: 300 }}>
            <Portrait2 person={p} size={64} />
            <div>
              <b>{p.name}</b> <span style={{ opacity: 0.6 }}>({p.role}, {p.archetype})</span>
              <div style={{ fontSize: 11, opacity: 0.8 }}>
                {p.role === "cast" && `rate ${money(p.dailyRate ?? 0)}/d · coop ${p.cooperation} · improv ${p.improv} · fame ${p.fame} · rider: ${p.rider}`}
                {p.role === "director" && `${p.avgVfxShots} vfx · ${p.avgLocations} locations · ${p.avgReshoots} reshoots · rating ${p.avgRating}`}
                {p.role === "writer" && `genres: ${p.capableGenres?.join(", ")} · rating ${p.avgRating}`}
                {p.role === "producer" && `len ×${p.avgProdLength?.toFixed(2)} · cost ×${p.avgProdCost?.toFixed(2)} · rev ×${p.avgProdRevenue?.toFixed(2)}`}
                {p.role === "critic" && `${p.outlet} · ${p.archetype} · harshness ${(p.harshness ?? 0).toFixed(2)}`}
              </div>
            </div>
          </div>
        ))}
      </div>
      <h4 style={{ margin: "14px 0 8px" }}>Minted pitches (from pitches.json grammars)</h4>
      {pitches.map((p, i) => (
        <div class="preview-card" key={i}>
          <div>
            <b>{p.title}</b> — {p.genre}/{p.subgenre}, {p.estRating}, min {money(p.minBudget)}, ~{p.estVfx} VFX
            <div style={{ fontSize: 11, opacity: 0.8 }}>{p.logline}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SimLabTab({ draft }: { draft: any }) {
  const [years, setYears] = useState(3);
  const [seeds, setSeeds] = useState(5);
  const [out, setOut] = useState("Run a batch to balance-test the current content.\nDisciplined-autopilot player + full rival sim, headless.");
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    setTimeout(() => {
      const content = assemble(undefined, draft);
      const lines: string[] = [];
      let survived = 0, bankrupt = 0, fired = 0;
      for (let s = 1; s <= seeds; s++) {
        const sim = newSeededRun(content, s * 1000 + 7);
        autoplay(sim, {
          days: DAYS_PER_YEAR * years,
          emailPolicy: disciplinedEmailPolicy(3),
          meetingPolicy: disciplinedMeetingPolicy(3),
        });
        const st = sim.state;
        const released = st.movies.filter((m) => m.studio === 0 && m.releaseDay !== undefined).length;
        const profit = sim.player.totalRevenue - sim.player.totalSpent;
        const ranked = [...st.studios].sort((a, b) => b.totalRevenue - b.totalSpent - (a.totalRevenue - a.totalSpent));
        const rank = ranked.indexOf(sim.player) + 1;
        if (!st.gameOver) survived++;
        else if (st.gameOver.kind === "bankrupt") bankrupt++;
        else fired++;
        lines.push(
          `seed ${s * 1000 + 7}: ${st.gameOver ? `${st.gameOver.kind.toUpperCase()} d${st.gameOver.day}` : `alive d${st.day}`} · rank #${rank} · ${released} released · profit ${money(profit)} · patience ${Math.round(st.patience)}`
        );
      }
      lines.push("", `survived ${survived}/${seeds} · bankrupt ${bankrupt} · fired ${fired}`);
      setOut(lines.join("\n"));
      setRunning(false);
    }, 30);
  };
  return (
    <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
      <div style={{ marginBottom: 10 }}>
        years <input type="number" value={years} onInput={(e) => setYears(parseInt((e.target as HTMLInputElement).value) || 1)} style={{ width: 60 }} />{" "}
        seeds <input type="number" value={seeds} onInput={(e) => setSeeds(parseInt((e.target as HTMLInputElement).value) || 1)} style={{ width: 60 }} />
        <button class="runbtn" onClick={run} disabled={running}>{running ? "running…" : "▶ run batch"}</button>
      </div>
      <div class="simlab-out">{out}</div>
    </div>
  );
}

function PublishTab({ draft, setDraft }: { draft: any; setDraft: (d: any) => void }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const filesInDraft = FILES.filter((f) => draft[f]);
  return (
    <div style={{ flex: 1, padding: 16 }}>
      <h4>Publish content to Cloudflare KV</h4>
      <p style={{ margin: "8px 0", opacity: 0.8 }}>
        Draft files: {filesInDraft.length ? filesInDraft.join(", ") : "none — nothing to publish"}. Published content is the primary
        source of truth: players load it on boot over the bundled copy.
      </p>
      <div style={{ margin: "10px 0" }}>
        password{" "}
        <input type="password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} style={{ width: 200 }} />
      </div>
      <button
        class="runbtn"
        onClick={async () => {
          setStatus("publishing…");
          try {
            const res = await fetch("/api/content", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password, files: draft }),
            });
            const j = await res.json().catch(() => ({}));
            setStatus(res.ok ? `✔ published version ${j.version ?? "?"}` : `✖ ${res.status}: ${j.error ?? "failed"}`);
          } catch (e) {
            setStatus(`✖ ${e}`);
          }
        }}
        disabled={!filesInDraft.length || !password}
      >
        ☁ publish drafts
      </button>
      <button
        class="runbtn"
        onClick={async () => {
          setStatus("pulling…");
          const pub = await fetchPublished();
          if (pub) {
            setDraft({ ...draft, ...pub });
            setStatus("✔ pulled published content into drafts");
          } else setStatus("nothing published yet (or offline)");
        }}
      >
        ⬇ pull live into drafts
      </button>
      <p style={{ marginTop: 10 }}>{status}</p>
    </div>
  );
}

// ---------- Sessions: PlayPen-style recorded-playsession browser + deterministic rewatch ----------
// List costs zero KV GETs (terse metadata rides on the key itself); opening a session fetches
// its full decision log once and replays it through the REAL kernel — no video, no screenshots,
// just the exact simulation reproduced from seed + decisions, scrubbable day by day.

interface SessionRow {
  id: string;
  p: string;
  boss: string;
  studio: string;
  t: string;
  d: number;
  n: number;
  rel: number;
  g: string;
  e: string;
  x: number;
  v: number;
}

function SessionsTab() {
  const [password, setPassword] = useState(() => sessionStorage.getItem("bob.sessionsPw") ?? "");
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [status, setStatus] = useState("");
  const [showTainted, setShowTainted] = useState(false);
  const [showDev, setShowDev] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    setStatus("loading…");
    try {
      const res = await fetch(`/api/sessions?password=${encodeURIComponent(password)}`);
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setStatus(`✖ ${j.error ?? res.status}`);
        return;
      }
      sessionStorage.setItem("bob.sessionsPw", password);
      setSessions(j.sessions);
      setStatus(`${j.sessions.length} session${j.sessions.length === 1 ? "" : "s"}`);
    } catch (e) {
      setStatus(`✖ ${e}`);
    }
  };

  if (openId) return <SessionRewatch id={openId} password={password} onBack={() => setOpenId(null)} />;

  const visible = (sessions ?? []).filter((s) => (showTainted || !s.x) && (showDev || !s.v));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: 12, display: "flex", gap: 10, alignItems: "center", borderBottom: "1px solid #2a3038", flexWrap: "wrap" }}>
        password{" "}
        <input type="password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} style={{ width: 160 }} />
        <button class="runbtn" onClick={load} disabled={!password}>
          ⬇ load sessions
        </button>
        <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={showTainted} onChange={(e) => setShowTainted((e.target as HTMLInputElement).checked)} />
          show tainted (bot/debug-driven)
        </label>
        <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={showDev} onChange={(e) => setShowDev((e.target as HTMLInputElement).checked)} />
          show dev (editor opened)
        </label>
        <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7 }}>{status}</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!sessions ? (
          <p style={{ padding: 16, opacity: 0.7 }}>Enter the editor password and load — this is who's actually been playing, on any machine.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", position: "sticky", top: 0, background: "#1c2026" }}>
                <th style={{ padding: 6 }}>started</th>
                <th style={{ padding: 6 }}>player</th>
                <th style={{ padding: 6 }}>boss / studio</th>
                <th style={{ padding: 6 }}>day</th>
                <th style={{ padding: 6 }}>decisions</th>
                <th style={{ padding: 6 }}>released</th>
                <th style={{ padding: 6 }}>ended</th>
                <th style={{ padding: 6 }}>flags</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id} style={{ cursor: "pointer", borderBottom: "1px solid #2a3038" }} onClick={() => setOpenId(s.id)}>
                  <td style={{ padding: 6 }}>{s.t ? new Date(s.t).toLocaleString() : "—"}</td>
                  <td style={{ padding: 6 }} title={s.p}>
                    {s.p.slice(0, 10)}
                  </td>
                  <td style={{ padding: 6 }}>
                    {s.boss || "?"} / {s.studio || "?"}
                  </td>
                  <td style={{ padding: 6 }}>{s.d}</td>
                  <td style={{ padding: 6 }}>{s.n}</td>
                  <td style={{ padding: 6 }}>{s.rel}</td>
                  <td style={{ padding: 6 }}>{s.g || s.e || "(open)"}</td>
                  <td style={{ padding: 6 }}>
                    {s.x ? "⚠bot " : ""}
                    {s.v ? "🛠dev" : ""}
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 24, opacity: 0.6 }}>
                    Nobody's played yet — or everything's filtered out.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface DaySnap {
  day: number;
  cash: number;
  patience: number;
  released: number;
  gameOver?: string;
}

function SessionRewatch({ id, password, onBack }: { id: string; password: string; onBack: () => void }) {
  const [status, setStatus] = useState("loading…");
  const [days, setDays] = useState<DaySnap[]>([]);
  const [decisionsByDay, setDecisionsByDay] = useState<Map<number, DecisionContext[]>>(new Map());
  const [meta, setMeta] = useState<any>(null);
  const [drift, setDrift] = useState<{ day: number; recordedHash: string; replayedHash: string }[] | null>(null);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sessions?id=${id}&password=${encodeURIComponent(password)}`);
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok || !j.ok) {
          setStatus(`✖ ${j.error ?? res.status}`);
          return;
        }
        setMeta(j.meta);
        // the session's OWN captured content — immune to whatever's published since, exactly
        // what replaySession needs for a bit-for-bit reproduction
        const snapshot: SessionSnapshot = { seed: j.seed, profile: j.profile, content: j.content, decisions: j.decisions, endDay: j.meta.endDay };
        const dayList: DaySnap[] = [];
        const decMap = new Map<number, DecisionContext[]>();
        const outcome = replaySession(
          snapshot,
          (sim) => {
            dayList.push({
              day: sim.state.day,
              cash: Math.round(sim.player.cash),
              patience: Math.round(sim.state.patience),
              released: sim.state.movies.filter((m) => m.studio === 0 && m.releaseDay !== undefined).length,
              gameOver: sim.state.gameOver?.kind,
            });
          },
          (ctx) => {
            const arr = decMap.get(ctx.day) ?? [];
            arr.push(ctx);
            decMap.set(ctx.day, arr);
          }
        );
        if (cancelled) return;
        setDays(dayList);
        setDecisionsByDay(decMap);
        setCursor(dayList.length ? dayList.length - 1 : 0);
        if (j.checkpoints?.length) setDrift(checkDrift(snapshot, j.checkpoints));
        setStatus(
          outcome.desync
            ? `⚠ desync at day ${outcome.desync.day}: ${outcome.desync.reason}`
            : `✔ replayed ${outcome.consumed}/${outcome.total} decisions across ${dayList.length} days`
        );
      } catch (e) {
        if (!cancelled) setStatus(`✖ ${e}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const cur = days[cursor];
  const d = cur ? calDate(cur.day) : null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <button onClick={onBack}>← back to list</button>
        <b>
          {meta?.profile?.boss ?? "?"} / {meta?.profile?.studio ?? "?"}
        </b>
        {meta?.ua && (
          <span style={{ fontSize: 11, opacity: 0.6 }} title={meta.ua}>
            {meta.viewport?.w}×{meta.viewport?.h}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12 }}>{status}</span>
      </div>
      {drift && (
        <div style={{ fontSize: 12, marginBottom: 8, color: drift.length ? "#e08080" : "#8fd08f" }}>
          {drift.length
            ? `⚠ drift detected at ${drift.length} checkpoint(s) — first mismatch: day ${drift[0].day} (content or code changed since this was recorded)`
            : "✔ exact reproduction — every checkpoint hash the live client recorded matches this replay"}
        </div>
      )}
      {days.length > 0 && cur && (
        <>
          <input
            type="range"
            min={0}
            max={days.length - 1}
            value={cursor}
            onInput={(e) => setCursor(parseInt((e.target as HTMLInputElement).value, 10))}
            style={{ width: "100%" }}
          />
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            Day {cur.day} {d && `(WK ${d.week} YR ${d.year})`} · cash {money(cur.cash)} · patience {cur.patience} · released {cur.released}
            {cur.gameOver ? ` · GAME OVER: ${cur.gameOver}` : ""}
          </div>
          <div style={{ flex: 1, overflowY: "auto", fontFamily: "monospace", fontSize: 12, background: "#0e1013", padding: 8 }}>
            {days
              .slice(0, cursor + 1)
              .flatMap((dd) => (decisionsByDay.get(dd.day) ?? []).map((dec, i) => ({ dd, dec, i })))
              .map(({ dd, dec, i }) => (
                <div key={`${dd.day}-${i}`} style={{ padding: "3px 0", borderBottom: "1px solid #222" }}>
                  <span style={{ opacity: 0.6 }}>day {dd.day}</span> — {dec.label}
                </div>
              ))}
            {!decisionsByDay.size && <p style={{ opacity: 0.6 }}>No decisions recorded — either an instant abandon, or purely a spectator stretch.</p>}
          </div>
        </>
      )}
    </div>
  );
}
