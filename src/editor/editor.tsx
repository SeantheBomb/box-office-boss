// Hidden editor (Ctrl+Shift+E). Fully-procedural game => the editor edits GENERATORS
// and TEMPLATES (content/*.json), never world instances. Draft overlay in localStorage,
// publish to Cloudflare KV via /api/content.

import { useMemo, useState } from "preact/hooks";
import { FILES, type ContentFile, assemble, loadDraft, saveDraft, clearDraft, fetchPublished } from "../data/content";
import { Sim } from "../kernel/sim";
import { autoplay, disciplinedEmailPolicy, disciplinedMeetingPolicy } from "../kernel/autopilot";
import { newSeededRun } from "../kernel/preseed";
import { makeRng } from "../kernel/rng";
import { mintWorld } from "../kernel/people";
import { mintPitch } from "../kernel/pitchgen";
import { money } from "../kernel/text";
import { Portrait2 } from "../surface/portraits2";
import { DAYS_PER_YEAR } from "../kernel/types";

type Tab = ContentFile | "preview" | "simlab" | "publish";

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
