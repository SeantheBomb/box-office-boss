// BossOS: knockoff-Mac shell. Menu bar up top, dock down bottom, windows in between,
// toasts drifting in from the corner. Meetings interrupt full-screen; dossiers float above.

import { useEffect, useRef, useState } from "preact/hooks";
import { Sim } from "../kernel/sim";
import { newSeededRun } from "../kernel/preseed";
import type { Content, SimEvent } from "../kernel/types";
import { calDate, DOW } from "../kernel/types";
import { money } from "../kernel/text";
import { saveLocal, loadLocal, clearLocal, exportSave, importSave } from "../kernel/save";
import { MeetingScene } from "./meeting";
import { Editor } from "../editor/editor";
import { useWindows, Window } from "./windows";
import { BUILD_VERSION, CHANGELOG } from "../version";
import { MailApp } from "./mail";
import { CalendarApp } from "./calendar";
import { StandingsChart, ProductionBoard, AudienceReport, WeekChart, MandateBoard, TownReport } from "./reports";
import { MovieDossier, PersonDossier } from "./dossiers";
import { DossierApp } from "./dossierapp";
import { audio } from "./audio";
import { MenuBar, Dock, ToastStack, Onboarding, type Profile, type Toast } from "./macos";
import { recorder } from "./recorder";

const APPS: { app: string; title: string; icon: string; w?: number; h?: number }[] = [
  { app: "mail", title: "✉ BossMail", icon: "✉", w: 640, h: 470 },
  { app: "calendar", title: "🗓 Calendar", icon: "🗓", w: 660, h: 360 },
  { app: "board", title: "🎬 Production Board", icon: "🎬", w: 680, h: 430 },
  { app: "standings", title: "📈 Standings", icon: "📈", w: 660, h: 480 },
  { app: "audience", title: "👥 Audience", icon: "👥", w: 620, h: 420 },
  { app: "dossier", title: "🗂 The Dossier", icon: "🗂", w: 520, h: 540 },
];

function detectStaleSave(): boolean {
  try {
    const raw = localStorage.getItem("bob.save");
    if (!raw) return false;
    return JSON.parse(raw).version !== 3;
  } catch {
    return false;
  }
}

const newSeed = () => (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;

export function App({ content }: { content: Content }) {
  const [staleSave, setStaleSave] = useState(detectStaleSave);
  const [sim, setSim] = useState<Sim | undefined>(() => (detectStaleSave() ? undefined : loadLocal(content)));
  const [showChangelog, setShowChangelog] = useState(
    () => !!localStorage.getItem("bob.save") && localStorage.getItem("bob.lastSeenVersion") !== BUILD_VERSION && !detectStaleSave()
  );
  const [, setTick] = useState(0);
  // bump() is the universal "something changed" signal (mail replies, dossier actions,
  // meetings, ticks) — syncing the recorder here catches every path in one place instead
  // of hunting down each call site.
  const bump = () => {
    recorder.sync();
    setTick((t) => t + 1);
  };
  const [speed, setSpeed] = useState(1);
  const [meetingQueue, setMeetingQueue] = useState<SimEvent[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [bouncing, setBouncing] = useState<Set<string>>(new Set());
  const wm = useWindows();
  const speedRef = useRef(speed);
  const simRef = useRef(sim);
  simRef.current = sim;
  speedRef.current = editorOpen || drawerOpen || staleSave || showChangelog || meetingQueue.length > 0 || !sim || sim.state.gameOver ? 0 : speed;
  const toastId = useRef(1);
  const notifyRef = useRef({ inboxLen: -1, day: -1 });

  const profile: Profile = sim?.state.flags.profile ?? { boss: "Boss", studio: sim?.state.studios[0]?.name ?? "Boss Films", wallpaper: "dusk" };

  (window as any).BOB_VERSION = BUILD_VERSION;

  const pushToast = (icon: string, title: string, body: string, onClick?: () => void) => {
    const id = toastId.current++;
    setToasts((ts) => [...ts.slice(-3), { id, icon, title, body, onClick }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 9000);
  };

  const bounceDock = (app: string) => {
    setBouncing((b) => new Set(b).add(app));
    setTimeout(() => setBouncing((b) => { const n = new Set(b); n.delete(app); return n; }), 2400);
  };

  const openDossier = (kind: "movie" | "person" | "studio" | "vfx", id: string) => {
    // every entity link in the game lands in THE Dossier — one app, searchable, with a back-trail
    const s = simRef.current;
    const name =
      kind === "movie" ? s?.movie(id)?.title :
      kind === "person" ? s?.person(id)?.name :
      kind === "studio" ? s?.state.studios[Number(id)]?.name :
      s?.state.vfxStudios.find((v) => v.id === id)?.name;
    audio.sfx("window_open", 0.7);
    wm.open("dossier", `🗂 ${name ?? "The Dossier"}`, { id: "dossier", props: { kind, id }, w: 520, h: 540 });
  };

  const collectMeetings = (meetings: SimEvent[]) => {
    if (meetings.length) setMeetingQueue((q) => [...q, ...meetings]);
  };

  /** New mail toasts + calendar reminders. Runs after any sim time movement. */
  const checkNotifications = () => {
    const s = simRef.current;
    if (!s) return;
    const ref = notifyRef.current;
    if (ref.inboxLen === -1) {
      ref.inboxLen = s.state.inbox.length;
      ref.day = s.state.day;
      return;
    }
    if (s.state.inbox.length > ref.inboxLen) {
      const fresh = s.state.inbox.slice(0, s.state.inbox.length - ref.inboxLen);
      for (const em of fresh.slice(0, 3)) {
        pushToast("✉", em.from, em.subject, () => wm.open("mail", "✉ BossMail", { w: 640, h: 470 }));
      }
      audio.sfx("email");
      bounceDock("mail");
    }
    ref.inboxLen = s.state.inbox.length;
    if (s.state.day !== ref.day) {
      ref.day = s.state.day;
      const openCal = () => wm.open("calendar", "🗓 Calendar", { w: 660, h: 360 });
      const label = (e: SimEvent) => {
        const m = s.movie(e.data.movieId);
        const p = s.person(e.data.personId ?? e.data.castId ?? e.data.writerId);
        return `${e.type.replace(/([A-Z])/g, " $1").toLowerCase()}${m ? ` — ${m.title}` : p ? ` — ${p.name}` : ""}`;
      };
      const today = s.state.events.filter((e) => e.kind === "meeting" && e.day === s.state.day);
      const tomorrow = s.state.events.filter((e) => e.kind === "meeting" && e.day === s.state.day + 1);
      if (today.length) {
        pushToast("🗓", "Today", today.map(label).join(" · "), openCal);
        audio.sfx("reminder");
        bounceDock("calendar");
      }
      if (tomorrow.length) {
        pushToast("🗓", "Tomorrow", tomorrow.map(label).join(" · "), openCal);
        if (!today.length) audio.sfx("reminder", 0.6);
      }
    }
  };

  // reset notification watermarks whenever a different run takes over, and begin/rotate
  // the session recording — the previous run (if any) is auto-ended inside begin()
  useEffect(() => {
    notifyRef.current = { inboxLen: -1, day: -1 };
    checkNotifications();
    if (sim) recorder.begin(sim);
  }, [sim]);

  const skipToNextEvent = () => {
    const s = simRef.current;
    if (!s || meetingQueue.length > 0) return;
    const logLen = s.state.eventLog.length;
    const inboxLen = s.state.inbox.length;
    const collected: SimEvent[] = [];
    for (let i = 0; i < 60 && !s.state.gameOver; i++) {
      collected.push(...s.advanceDay());
      if (collected.length || s.state.eventLog.length !== logLen || s.state.inbox.length !== inboxLen) break;
    }
    collectMeetings(collected);
    saveLocal(s);
    checkNotifications();
    bump();
  };

  useEffect(() => {
    (window as any).BOB = {
      sim: () => simRef.current,
      skipDays: (n: number) => {
        const s = simRef.current;
        if (!s) return;
        recorder.taint("debug-skipDays"); // the scripted-playtest entry point — never a real session
        const collected: SimEvent[] = [];
        for (let i = 0; i < n && !s.state.gameOver; i++) collected.push(...s.advanceDay());
        collectMeetings(collected);
        checkNotifications();
        recorder.sync();
        setTick((t) => t + 1);
      },
    };
    // audio unlock on the first real interaction
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    let last = performance.now();
    const iv = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const s = simRef.current;
      if (!s || speedRef.current === 0 || s.state.gameOver) return;
      s.state.timeOfDay += (dt / s.content.game.secondsPerDay) * speedRef.current;
      if (s.state.timeOfDay >= 1) {
        collectMeetings(s.advanceDay());
        if (s.state.day % s.content.game.autosaveEveryDays === 0 || s.state.gameOver) saveLocal(s);
        checkNotifications();
        recorder.sync();
      }
      setTick((t) => t + 1);
    }, 100);
    return () => clearInterval(iv);
  }, []);

  // ambience + music follow the scene
  const meetingScene = meetingQueue.length > 0 ? (sim?.content.meetings[meetingQueue[0].type]?.scene ?? "meetingRoom") : "office";
  useEffect(() => {
    audio.setScene(meetingScene === "office" ? "office" : meetingScene);
  }, [meetingScene]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyE") {
        e.preventDefault();
        recorder.markDevOpened(); // editor access this session — flagged, not tainted (a dev poking around is still real play)
        setEditorOpen((v) => !v);
      }
      if (e.code === "Space" && !editorOpen && !drawerOpen && meetingQueue.length === 0) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          e.preventDefault();
          setSpeed((sp) => (sp === 0 ? 1 : 0));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorOpen, drawerOpen, meetingQueue.length]);

  const startRun = (p: Profile) => {
    clearLocal();
    const s = newSeededRun(content, newSeed(), p);
    setSim(s);
    setMeetingQueue([]);
    setDrawerOpen(false);
    saveLocal(s);
    localStorage.setItem("bob.lastSeenVersion", BUILD_VERSION);
    bump();
  };

  // ---------- gates: breaking save → onboarding → game ----------
  if (staleSave) {
    return (
      <div class="game wp-dusk">
        <div class="modal-veil">
          <div class="update-modal">
            <h3>🎬 Studio Renovation — v{BUILD_VERSION}</h3>
            <p>A major update rebuilt the studio from the foundation up. Your old save predates the new systems and <b>can't be carried forward</b>.</p>
            <ul>{CHANGELOG.map((c, i) => <li key={i}>{c}</li>)}</ul>
            <p><b>To play the new version, your save needs to be reset.</b></p>
            <button
              class="update-confirm"
              onClick={() => {
                clearLocal();
                setStaleSave(false);
                setSim(undefined); // falls through to onboarding
              }}
            >
              Reset save & set up the new studio ▸
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!sim) return <Onboarding onDone={startRun} />;

  const st = sim.state;
  const unread = st.inbox.filter((e) => !e.read).length;
  const actionable = st.inbox.filter((e) => e.actions.length && !e.actionTaken).length;
  const tier = sim.toneTier();

  if (st.gameOver) {
    const go = st.gameOver;
    return (
      <div class={`game wp-${profile.wallpaper}`}>
        <div class="gameover">
          <h1>{go.kind === "bankrupt" ? "THE MONEY RAN OUT" : "THE BOARD HAS DECIDED"}</h1>
          <p style={{ maxWidth: 520, lineHeight: 1.6 }}>
            {go.kind === "bankrupt"
              ? "The accountants stopped calling back. The parking spot has someone else's name on it by Thursday."
              : "Security is very polite. They let you keep the stapler. The trades will call it a 'transition'."}
          </p>
          <p>
            {profile.boss}, you ran {profile.studio} for <b>{Math.floor(go.day / 336) + 1}</b> year(s). Movies released:{" "}
            <b>{st.movies.filter((m) => m.studio === 0 && m.releaseDay !== undefined).length}</b>. Final profit:{" "}
            <b>{money(sim.player.totalRevenue - sim.player.totalSpent)}</b>.
          </p>
          <button onClick={() => setSim(undefined)}>Start a New Studio</button>
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
            <TownReport sim={sim} openDossier={openDossier} />
            <MandateBoard sim={sim} />
            <h3>This Week at the Box Office</h3>
            <WeekChart sim={sim} openDossier={openDossier} />
            <h3 style={{ marginTop: 14 }}>Standings — released-picture profit</h3>
            <StandingsChart sim={sim} openDossier={openDossier} />
          </div>
        );
      case "audience":
        return (
          <div class="report-sheet windowed">
            <AudienceReport sim={sim} />
          </div>
        );
      case "dossier":
        return <DossierApp sim={sim} kind={props?.kind} id={props?.id} openDossier={openDossier} bump={bump} />;
      case "movieDossier":
        return (
          <div class="report-sheet windowed">
            <MovieDossier sim={sim} movieId={props?.id} openDossier={openDossier} bump={bump} />
          </div>
        );
      case "personDossier":
        return (
          <div class="report-sheet windowed">
            <PersonDossier sim={sim} personId={props?.id} openDossier={openDossier} bump={bump} />
          </div>
        );
    }
    return null;
  };

  const openApp = (app: string) => {
    const a = APPS.find((x) => x.app === app);
    if (!a) return;
    audio.sfx("window_open", 0.7);
    wm.open(a.app, a.title, { w: a.w, h: a.h });
  };

  return (
    <div class={`game mac wp-${profile.wallpaper}`}>
      <MenuBar
        sim={sim}
        profile={profile}
        speed={speed}
        setSpeed={(n) => { audio.sfx("click", 0.4); setSpeed(n); }}
        onSkip={skipToNextEvent}
        inMeeting={meetingQueue.length > 0}
        unread={unread}
        actionable={actionable}
        onOpenApp={openApp}
        onDrawer={() => setDrawerOpen(true)}
        apps={APPS}
      />
      <div class="day-progress"><div style={{ width: `${Math.min(100, st.timeOfDay * 100)}%` }} /></div>
      <div class="scene">
        {meetingQueue.length > 0 ? (
          <MeetingScene
            key={meetingQueue[0].id}
            sim={sim}
            event={meetingQueue[0]}
            openDossier={openDossier}
            onDone={() => {
              audio.sfx("window_close", 0.6);
              setMeetingQueue((q) => q.slice(1));
              saveLocal(sim);
              checkNotifications();
              bump();
            }}
          />
        ) : (
          <div class="desktop">
            <div class={`desk-tint ${st.timeOfDay > 0.66 ? "evening" : ""} ${tier >= 2 ? "stressed" : ""}`} />
            <div class="wp-credit">{profile.studio}</div>
          </div>
        )}
        {wm.wins
          .filter((w) => meetingQueue.length === 0 || w.app === "dossier" || w.app === "movieDossier" || w.app === "personDossier")
          .map((w) => (
            <Window
              key={w.id}
              win={w}
              onClose={() => { audio.sfx("window_close", 0.6); wm.close(w.id); }}
              onFocus={() => wm.focus(w.id)}
              onMinimize={() => { audio.sfx("window_close", 0.4); wm.minimize(w.id); }}
              onMove={(dx, dy) => wm.move(w.id, dx, dy)}
              onResize={(dw, dh) => wm.resize(w.id, dw, dh)}
              badge={w.app === "mail" && actionable ? String(actionable) : undefined}
            >
              {renderApp(w.app, w.props)}
            </Window>
          ))}
        {meetingQueue.length === 0 && (
          <Dock
            apps={APPS}
            openApps={new Set(wm.wins.filter((w) => !w.min).map((w) => w.app))}
            bouncing={bouncing}
            minned={wm.wins.filter((w) => w.min).map((w) => ({ id: w.id, title: w.title }))}
            onOpen={openApp}
            onFocusMin={(id) => { audio.sfx("window_open", 0.5); wm.focus(id); }}
            onDrawer={() => setDrawerOpen(true)}
            mailBadge={actionable}
          />
        )}
        <ToastStack toasts={toasts} dismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
        {showChangelog && (
          <div class="modal-veil" onClick={() => { localStorage.setItem("bob.lastSeenVersion", BUILD_VERSION); setShowChangelog(false); }}>
            <div class="update-modal" onClick={(e) => e.stopPropagation()}>
              <h3>📋 Studio Memo — v{BUILD_VERSION}</h3>
              <p>While you were out, the following changed on the lot:</p>
              <ul>{CHANGELOG.map((c, i) => <li key={i}>{c}</li>)}</ul>
              <button class="update-confirm" onClick={() => { localStorage.setItem("bob.lastSeenVersion", BUILD_VERSION); setShowChangelog(false); }}>
                Noted. Back to work ▸
              </button>
            </div>
          </div>
        )}
        {drawerOpen && (
          <DrawerModal
            sim={sim}
            onClose={() => setDrawerOpen(false)}
            onNew={() => {
              if (confirm("Abandon this studio and start fresh?")) {
                clearLocal();
                setSim(undefined);
                setDrawerOpen(false);
              }
            }}
            onImport={(json) => {
              try {
                const s = importSave(content, json);
                setSim(s);
                saveLocal(s);
                setDrawerOpen(false);
              } catch (err) {
                alert(`Import failed: ${err}`);
              }
            }}
          />
        )}
        {editorOpen && <Editor onClose={() => setEditorOpen(false)} />}
      </div>
    </div>
  );
}

function DrawerModal({ sim, onClose, onNew, onImport }: { sim: Sim; onClose: () => void; onNew: () => void; onImport: (json: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div class="modal-veil" style={{ zIndex: 400 }} onClick={onClose}>
      <div class="drawer-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Desk Drawer</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={() => { saveLocal(sim); audio.sfx("stamp", 0.7); onClose(); }}>💾 Save now</button>
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
          <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", padding: "4px 2px" }}>
            <input
              type="checkbox"
              checked={localStorage.getItem("bob.timedChoices") === "1"}
              onChange={(e) => localStorage.setItem("bob.timedChoices", (e.target as HTMLInputElement).checked ? "1" : "0")}
            />
            ⏱ Timed choices in tense moments (Telltale mode)
          </label>
          <button onClick={onNew}>🎬 New studio (new name, new seed)</button>
          <button onClick={onClose}>Close</button>
        </div>
        <p style={{ marginTop: 12, fontSize: 11, color: "#666" }}>
          Seed {sim.state.seed} · Day {sim.state.day} · v{BUILD_VERSION} · autosaves weekly · Ctrl+Shift+E for the editor
        </p>
      </div>
    </div>
  );
}
