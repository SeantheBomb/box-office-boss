// BossOS: the office monitor is now the whole game surface. Windows over a desk backdrop,
// taskbar, persistent chrome. Meetings interrupt full-screen; everything else is a window.

import { useEffect, useRef, useState } from "preact/hooks";
import { Sim } from "../kernel/sim";
import { newSeededRun } from "../kernel/preseed";
import type { Content, SimEvent } from "../kernel/types";
import { fmtDate } from "../kernel/types";
import { money } from "../kernel/text";
import { saveLocal, loadLocal, clearLocal, exportSave, importSave } from "../kernel/save";
import { MeetingScene } from "./meeting";
import { Editor } from "../editor/editor";
import { useWindows, Window } from "./windows";
import { MailApp } from "./mail";
import { CalendarApp } from "./calendar";
import { StandingsChart, ProductionBoard, AudienceReport } from "./reports";
import { MovieDossier, PersonDossier } from "./dossiers";

const APPS: { app: string; title: string; icon: string; w?: number; h?: number }[] = [
  { app: "mail", title: "✉ BossMail", icon: "✉", w: 620, h: 460 },
  { app: "calendar", title: "🗓 Calendar", icon: "🗓", w: 640, h: 340 },
  { app: "board", title: "🎬 Production Board", icon: "🎬", w: 660, h: 420 },
  { app: "standings", title: "📈 Standings", icon: "📈", w: 640, h: 460 },
  { app: "audience", title: "👥 Audience", icon: "👥", w: 620, h: 420 },
];

export function App({ content }: { content: Content }) {
  const [sim, setSim] = useState<Sim>(() => loadLocal(content) ?? newSeededRun(content, (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0));
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const [speed, setSpeed] = useState(1);
  const [meetingQueue, setMeetingQueue] = useState<SimEvent[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [toast, setToast] = useState<string | undefined>();
  const wm = useWindows();
  const speedRef = useRef(speed);
  speedRef.current = editorOpen || drawerOpen || meetingQueue.length > 0 || sim.state.gameOver ? 0 : speed;
  const simRef = useRef(sim);
  simRef.current = sim;

  const openDossier = (kind: "movie" | "person", id: string) => {
    const title = kind === "movie" ? `📁 ${simRef.current.movie(id)?.title ?? "?"}` : `👤 ${simRef.current.person(id)?.name ?? "?"}`;
    wm.open(kind === "movie" ? "movieDossier" : "personDossier", title, { id: `${kind}:${id}`, props: { id }, w: 460, h: 480 });
  };

  const collectMeetings = (meetings: SimEvent[]) => {
    if (meetings.length) setMeetingQueue((q) => [...q, ...meetings]);
  };

  const skipToNextEvent = () => {
    const s = simRef.current;
    const inboxLen = s.state.inbox.length;
    const collected: SimEvent[] = [];
    for (let i = 0; i < 60 && !s.state.gameOver; i++) {
      collected.push(...s.advanceDay());
      if (collected.length || s.state.inbox.length !== inboxLen) break;
    }
    collectMeetings(collected);
    saveLocal(s);
    bump();
  };

  useEffect(() => {
    (window as any).BOB = {
      sim: () => simRef.current,
      skipDays: (n: number) => {
        const s = simRef.current;
        const collected: SimEvent[] = [];
        for (let i = 0; i < n && !s.state.gameOver; i++) collected.push(...s.advanceDay());
        collectMeetings(collected);
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
        collectMeetings(s.advanceDay());
        if (s.state.day % s.content.game.autosaveEveryDays === 0 || s.state.gameOver) saveLocal(s);
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

  const newRun = () => {
    clearLocal();
    const s = newSeededRun(content, (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    setSim(s);
    setMeetingQueue([]);
    setDrawerOpen(false);
    saveLocal(s);
    bump();
  };

  const st = sim.state;
  const unread = st.inbox.filter((e) => !e.read).length;
  const actionable = st.inbox.filter((e) => e.actions.length && !e.actionTaken).length;
  const tier = sim.toneTier();

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
          <button onClick={newRun}>Start a New Studio</button>
        </div>
      </div>
    );
  }

  const renderApp = (app: string, props?: Record<string, any>) => {
    switch (app) {
      case "mail":
        return <MailApp sim={sim} bump={bump} openDossier={openDossier} />;
      case "calendar":
        return <CalendarApp sim={sim} openDossier={openDossier} />;
      case "board":
        return (
          <div class="report-sheet windowed">
            <ProductionBoard sim={sim} openDossier={openDossier} />
          </div>
        );
      case "standings":
        return (
          <div class="report-sheet windowed">
            <h3>Box Office Standings — released-picture profit</h3>
            <StandingsChart sim={sim} />
          </div>
        );
      case "audience":
        return (
          <div class="report-sheet windowed">
            <AudienceReport sim={sim} />
          </div>
        );
      case "movieDossier":
        return (
          <div class="report-sheet windowed">
            <MovieDossier sim={sim} movieId={props?.id} openDossier={openDossier} />
          </div>
        );
      case "personDossier":
        return (
          <div class="report-sheet windowed">
            <PersonDossier sim={sim} personId={props?.id} openDossier={openDossier} />
          </div>
        );
    }
    return null;
  };

  return (
    <div class="game">
      <div class="scene">
        {toast && <div class="toast">{toast}</div>}
        {meetingQueue.length > 0 ? (
          <MeetingScene
            key={meetingQueue[0].id}
            sim={sim}
            event={meetingQueue[0]}
            openDossier={(kind, id) => {
              /* dossiers open behind the meeting; visible after */
              openDossier(kind, id);
            }}
            onDone={() => {
              setMeetingQueue((q) => q.slice(1));
              saveLocal(sim);
              bump();
            }}
          />
        ) : (
          <div class="desktop">
            <div class={`desk-backdrop ${st.timeOfDay > 0.66 ? "evening" : ""}`}>
              <div class="window-view" />
              <div class={`logo ${tier >= 3 ? "doomed" : tier >= 2 ? "stressed" : ""}`}>{sim.content.game.studioName}</div>
            </div>
            {wm.wins.map((w) => (
              <Window
                key={w.id}
                win={w}
                onClose={() => wm.close(w.id)}
                onFocus={() => wm.focus(w.id)}
                onMinimize={() => wm.minimize(w.id)}
                onMove={(dx, dy) => wm.move(w.id, dx, dy)}
                onResize={(dw, dh) => wm.resize(w.id, dw, dh)}
                badge={w.app === "mail" && actionable ? String(actionable) : undefined}
              >
                {renderApp(w.app, w.props)}
              </Window>
            ))}
            <div class="taskbar">
              <span class="taskbar-brand">BossOS</span>
              {APPS.map((a) => {
                const win = wm.wins.find((w) => w.app === a.app);
                return (
                  <button
                    key={a.app}
                    class={win && !win.min ? "open" : ""}
                    onClick={() => wm.open(a.app, a.title, { w: a.w, h: a.h })}
                    title={a.title}
                  >
                    {a.icon}
                    {a.app === "mail" && actionable > 0 && <span class="task-badge">{actionable}</span>}
                    {a.app === "mail" && !actionable && unread > 0 && <span class="task-badge dim">{unread}</span>}
                  </button>
                );
              })}
              <span style={{ flex: 1 }} />
              {wm.wins.filter((w) => w.min).map((w) => (
                <button key={w.id} class="minned" onClick={() => wm.focus(w.id)}>
                  {w.title.slice(0, 18)}
                </button>
              ))}
              <button onClick={() => setDrawerOpen(true)} title="Desk drawer">🗄</button>
            </div>
          </div>
        )}
        {drawerOpen && (
          <DrawerModal
            sim={sim}
            onClose={() => setDrawerOpen(false)}
            onNew={() => {
              if (confirm("Abandon this studio and start fresh?")) newRun();
            }}
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
        <button onClick={skipToNextEvent} title="Jump to the next meeting or email">⏭ next event</button>
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
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
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
          <button onClick={onNew}>🎬 New studio (new seed)</button>
          <button onClick={onClose}>Close</button>
        </div>
        <p style={{ marginTop: 12, fontSize: 11, color: "#666" }}>
          Seed {sim.state.seed} · Day {sim.state.day} · autosaves weekly · Ctrl+Shift+E for the editor
        </p>
      </div>
    </div>
  );
}
