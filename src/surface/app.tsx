// App shell: clock loop, scene routing, chrome, drawer, game over.

import { useEffect, useRef, useState } from "preact/hooks";
import { Sim } from "../kernel/sim";
import type { Content, SimEvent } from "../kernel/types";
import { fmtDate } from "../kernel/types";
import { money } from "../kernel/text";
import { saveLocal, loadLocal, clearLocal, exportSave, importSave } from "../kernel/save";
import { OfficeScene, CalendarScene, ReportsScene } from "./scenes";
import { MeetingScene } from "./meeting";
import { Editor } from "../editor/editor";

export function App({ content }: { content: Content }) {
  const [sim, setSim] = useState<Sim>(() => loadLocal(content) ?? Sim.newRun(content, (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0));
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const [scene, setScene] = useState<"office" | "calendar" | "reports">("office");
  const [speed, setSpeed] = useState(1);
  const [meetingQueue, setMeetingQueue] = useState<SimEvent[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [toast, setToast] = useState<string | undefined>();
  const speedRef = useRef(speed);
  speedRef.current = editorOpen || drawerOpen || meetingQueue.length > 0 || sim.state.gameOver ? 0 : speed;
  const simRef = useRef(sim);
  simRef.current = sim;

  useEffect(() => {
    // debug handle for scripted playtests (never used by game code)
    (window as any).BOB = {
      sim: () => simRef.current,
      skipDays: (n: number) => {
        const s = simRef.current;
        const collected: SimEvent[] = [];
        for (let i = 0; i < n && !s.state.gameOver; i++) collected.push(...s.advanceDay());
        if (collected.length) setMeetingQueue((q) => [...q, ...collected]);
        setTick((t) => t + 1);
      },
    };
  }, []);

  useEffect(() => {
    let last = performance.now();
    const iv = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const s = simRef.current;
      if (speedRef.current === 0 || s.state.gameOver) return;
      s.state.timeOfDay += (dt / s.content.game.secondsPerDay) * speedRef.current;
      if (s.state.timeOfDay >= 1) {
        const meetings = s.advanceDay();
        if (meetings.length) {
          setMeetingQueue((q) => [...q, ...meetings]);
        }
        if (s.state.day % s.content.game.autosaveEveryDays === 0) saveLocal(s);
        if (s.state.gameOver) saveLocal(s);
      }
      setTick((t) => t + 1);
    }, 100);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyE") {
        e.preventDefault();
        setEditorOpen((v) => !v);
      }
      if (e.code === "Space" && !editorOpen && !drawerOpen) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          e.preventDefault();
          setSpeed((sp) => (sp === 0 ? 1 : 0));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorOpen, drawerOpen]);

  const newRun = (seed?: number) => {
    clearLocal();
    const s = Sim.newRun(content, seed ?? ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0));
    setSim(s);
    setMeetingQueue([]);
    setScene("office");
    setDrawerOpen(false);
    bump();
  };

  const st = sim.state;
  const unread = st.inbox.filter((e) => !e.read).length;
  const actionable = st.inbox.filter((e) => e.actions.length && !e.actionTaken).length;

  if (st.gameOver) {
    const go = st.gameOver;
    return (
      <div class="game">
        <div class="gameover">
          <h1>{go.kind === "bankrupt" ? "THE MONEY RAN OUT" : "THE BOARD HAS DECIDED"}</h1>
          <p style={{ maxWidth: 520, lineHeight: 1.6 }}>
            {go.kind === "bankrupt"
              ? "The accountants stopped calling back. The parking spot has someone else's name on it by Thursday."
              : "Security is very polite. They let you keep the stapler. The trades will call it a 'transition'."}
          </p>
          <p>
            You lasted <b>{Math.floor(go.day / 336) + 1}</b> year(s). Movies released:{" "}
            <b>{st.movies.filter((m) => m.studio === 0 && m.releaseDay !== undefined).length}</b>. Final profit:{" "}
            <b>{money(sim.player.totalRevenue - sim.player.totalSpent)}</b>.
          </p>
          <button onClick={() => newRun()}>Start a New Studio</button>
        </div>
      </div>
    );
  }

  return (
    <div class="game">
      <div class="scene">
        {toast && <div class="toast">{toast}</div>}
        {meetingQueue.length > 0 ? (
          <MeetingScene
            sim={sim}
            event={meetingQueue[0]}
            onDone={() => {
              setMeetingQueue((q) => q.slice(1));
              saveLocal(sim);
              bump();
            }}
          />
        ) : scene === "office" ? (
          <OfficeScene sim={sim} bump={bump} onNavigate={(s) => setScene(s as any)} drawer={() => setDrawerOpen(true)} />
        ) : scene === "calendar" ? (
          <CalendarScene sim={sim} onBack={() => setScene("office")} />
        ) : (
          <ReportsScene sim={sim} onBack={() => setScene("office")} />
        )}
        {drawerOpen && (
          <DrawerModal
            sim={sim}
            onClose={() => setDrawerOpen(false)}
            onNew={() => newRun()}
            onImport={(json) => {
              try {
                const s = importSave(content, json);
                setSim(s);
                saveLocal(s);
                setDrawerOpen(false);
                setToast("Save imported.");
                setTimeout(() => setToast(undefined), 2500);
              } catch (err) {
                alert(`Import failed: ${err}`);
              }
            }}
          />
        )}
        {editorOpen && <Editor onClose={() => setEditorOpen(false)} />}
      </div>
      <div class="chrome">
        <span class="date">{fmtDate(st.day)}</span>
        <div class="daybar"><div style={{ width: `${Math.min(100, st.timeOfDay * 100)}%` }} /></div>
        <button class={speed === 0 ? "on" : ""} onClick={() => setSpeed(0)}>⏸</button>
        <button class={speed === 1 ? "on" : ""} onClick={() => setSpeed(1)}>1×</button>
        <button class={speed === 2 ? "on" : ""} onClick={() => setSpeed(2)}>2×</button>
        <button class={speed === 4 ? "on" : ""} onClick={() => setSpeed(4)}>4×</button>
        {scene !== "office" && <button onClick={() => setScene("office")}>🖥 desk</button>}
        <span style={{ fontSize: 12, opacity: 0.8 }}>
          ✉ {unread} unread{actionable ? ` · ${actionable} need replies` : ""}
        </span>
        <span class={`cash ${sim.player.cash < 5_000_000 ? "low" : ""}`}>💰 {money(sim.player.cash)}</span>
      </div>
    </div>
  );
}

function DrawerModal({ sim, onClose, onNew, onImport }: { sim: Sim; onClose: () => void; onNew: () => void; onImport: (json: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#f4eee2", color: "#1c1a17", padding: 24, minWidth: 340, boxShadow: "0 20px 60px #000" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontVariant: "small-caps", letterSpacing: 2, marginBottom: 12 }}>Desk Drawer</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={() => { saveLocal(sim); onClose(); }}>💾 Save now</button>
          <button
            onClick={() => {
              const blob = new Blob([exportSave(sim)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `box-office-boss-save-day${sim.state.day}.json`;
              a.click();
            }}
          >
            📤 Export save (JSON)
          </button>
          <button onClick={() => fileRef.current?.click()}>📥 Import save</button>
          <input
            type="file"
            accept=".json"
            ref={fileRef}
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) onImport(await f.text());
            }}
          />
          <button onClick={() => { if (confirm("Abandon this studio and start fresh?")) onNew(); }}>🎬 New studio (new seed)</button>
          <button onClick={onClose}>Close</button>
        </div>
        <p style={{ marginTop: 12, fontSize: 11, color: "#666" }}>
          Seed {sim.state.seed} · Day {sim.state.day} · autosaves weekly · Ctrl+Shift+E for the editor
        </p>
      </div>
    </div>
  );
}
