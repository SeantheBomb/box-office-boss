// The knockoff-Mac layer: menu bar, dock, toast center, onboarding, wallpapers.
// Only the finest for an exec.

import { useEffect, useRef, useState } from "preact/hooks";
import type { Sim } from "../kernel/sim";
import { calDate, DOW, SEASONS } from "../kernel/types";
import { money } from "../kernel/text";
import { audio } from "./audio";

export interface Profile {
  boss: string;
  studio: string;
  wallpaper: string;
}

export const WALLPAPERS: { id: string; name: string }[] = [
  { id: "dusk", name: "Dusk on the Lot" },
  { id: "golden", name: "Golden Hour" },
  { id: "midnight", name: "Midnight Premiere" },
  { id: "palm", name: "Palm Noir" },
  { id: "teal", name: "Studio Teal" },
  { id: "champagne", name: "Champagne" },
];

// ---------------- onboarding ----------------
export function Onboarding({ onDone }: { onDone: (p: Profile) => void }) {
  const [boss, setBoss] = useState("");
  const [studio, setStudio] = useState("");
  const [wallpaper, setWallpaper] = useState("dusk");
  const ready = boss.trim().length > 0 && studio.trim().length > 0;
  return (
    <div class={`onboarding wp-${wallpaper}`}>
      <div class="onboard-card">
        <div class="onboard-logo">🎬</div>
        <h1>BossOS</h1>
        <p class="onboard-sub">Before the town learns your name, tell it to the machine.</p>
        <label>
          Your name
          <input value={boss} placeholder="e.g. Sam Sterling" maxLength={24} onInput={(e) => setBoss((e.target as HTMLInputElement).value)} />
        </label>
        <label>
          Your studio
          <input value={studio} placeholder="e.g. Sterling Pictures" maxLength={28} onInput={(e) => setStudio((e.target as HTMLInputElement).value)} />
        </label>
        <div class="onboard-wp-label">Desktop wallpaper</div>
        <div class="onboard-wallpapers">
          {WALLPAPERS.map((w) => (
            <button key={w.id} class={`wp-thumb wp-${w.id} ${wallpaper === w.id ? "sel" : ""}`} title={w.name} onClick={() => setWallpaper(w.id)}>
              <span>{w.name}</span>
            </button>
          ))}
        </div>
        <button
          class="onboard-go"
          disabled={!ready}
          onClick={() => {
            audio.unlock();
            audio.sfx("success");
            onDone({ boss: boss.trim(), studio: studio.trim(), wallpaper });
          }}
        >
          Take the chair ▸
        </button>
        <p class="onboard-fine">You inherit a working studio: a mid-flight slate, two producers, and a board that believes in you (today).</p>
      </div>
    </div>
  );
}

// ---------------- menu bar ----------------
export function MenuBar({
  sim,
  profile,
  speed,
  setSpeed,
  onSkip,
  inMeeting,
  unread,
  actionable,
  onOpenApp,
  onDrawer,
  apps,
}: {
  sim: Sim;
  profile: Profile;
  speed: number;
  setSpeed: (n: number) => void;
  onSkip: () => void;
  inMeeting: boolean;
  unread: number;
  actionable: number;
  onOpenApp: (app: string) => void;
  onDrawer: () => void;
  apps: { app: string; title: string; icon: string }[];
}) {
  const [menu, setMenu] = useState<string | undefined>();
  const d = calDate(sim.state.day);
  // sim clock: the working day runs 8:00 → 22:00
  const mins = Math.floor(8 * 60 + sim.state.timeOfDay * 14 * 60);
  const hh = Math.floor(mins / 60);
  const mm = String(mins % 60).padStart(2, "0");
  const clock = `${((hh + 11) % 12) + 1}:${mm} ${hh >= 12 ? "PM" : "AM"}`;
  useEffect(() => {
    const close = () => setMenu(undefined);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);
  const toggle = (m: string) => (e: Event) => {
    e.stopPropagation();
    setMenu(menu === m ? undefined : m);
  };
  return (
    <div class="menubar" onPointerDown={(e) => e.stopPropagation()}>
      <button class={`mb-item mb-logo ${menu === "logo" ? "on" : ""}`} onClick={toggle("logo")}>🎬</button>
      <button class={`mb-item mb-studio ${menu === "studio" ? "on" : ""}`} onClick={toggle("studio")}>{profile.studio}</button>
      <button class={`mb-item ${menu === "apps" ? "on" : ""}`} onClick={toggle("apps")}>Apps</button>
      <button class={`mb-item ${menu === "sound" ? "on" : ""}`} onClick={toggle("sound")}>Sound</button>
      <span class="mb-flex" />
      <span class="mb-item mb-cash" title="Studio cash (private)">{money(sim.player.cash)}</span>
      <span class="mb-item mb-mail" title={`${unread} unread · ${actionable} need replies`} onClick={() => onOpenApp("mail")}>
        ✉{actionable > 0 ? <b class="mb-badge">{actionable}</b> : null}
      </span>
      {inMeeting ? (
        <span class="mb-item mb-paused" title="Time is paused: someone is in the room with you. Finish the meeting to get the clock back.">⏸ in a meeting</span>
      ) : (
        <span class="mb-speed">
          <button class={speed === 0 ? "on" : ""} title="Pause (Space)" onClick={() => setSpeed(0)}>⏸</button>
          <button class={speed === 1 ? "on" : ""} title="Normal speed" onClick={() => setSpeed(1)}>▶</button>
          <button class={speed === 4 ? "on" : ""} title="Fast" onClick={() => setSpeed(4)}>▶▶</button>
          <button title="Skip to the next event" onClick={onSkip}>⏭</button>
        </span>
      )}
      <span class="mb-item mb-clock" title={`${SEASONS[d.season]} · Year ${d.year}`}>
        {DOW[d.dayOfWeek]} WK{d.week} · {clock}
      </span>

      {menu === "logo" && (
        <div class="mb-menu" style={{ left: 8 }}>
          <div class="mb-menu-title">BossOS · v{(window as any).BOB_VERSION ?? ""}</div>
          <button onClick={() => { setMenu(undefined); onDrawer(); }}>About This Studio…</button>
        </div>
      )}
      {menu === "studio" && (
        <div class="mb-menu" style={{ left: 44 }}>
          <div class="mb-menu-title">{profile.studio} — {profile.boss}, Executive</div>
          <button onClick={() => { setMenu(undefined); onDrawer(); }}>Saves & Settings…</button>
        </div>
      )}
      {menu === "apps" && (
        <div class="mb-menu" style={{ left: 150 }}>
          {apps.map((a) => (
            <button key={a.app} onClick={() => { setMenu(undefined); onOpenApp(a.app); }}>
              {a.icon} {a.title.replace(/^[^\s]+\s/, "")}
            </button>
          ))}
        </div>
      )}
      {menu === "sound" && <SoundMenu />}
    </div>
  );
}

function SoundMenu() {
  const [, force] = useState(0);
  const slider = (label: string, key: keyof typeof audio.vol) => (
    <label class="mb-slider">
      {label}
      <input
        type="range"
        min="0"
        max="100"
        value={Math.round((audio.vol[key] as number) * 100)}
        onInput={(e) => {
          (audio.vol as any)[key] = parseInt((e.target as HTMLInputElement).value) / 100;
          audio.saveVol();
          force((x) => x + 1);
        }}
      />
    </label>
  );
  return (
    <div class="mb-menu mb-sound" style={{ left: 200 }} onClick={(e) => e.stopPropagation()}>
      <label class="mb-slider mb-mute">
        <input
          type="checkbox"
          checked={audio.vol.muted}
          onChange={(e) => {
            audio.vol.muted = (e.target as HTMLInputElement).checked;
            audio.saveVol();
            force((x) => x + 1);
          }}
        />
        Mute everything
      </label>
      {slider("Master", "master")}
      {slider("Music", "music")}
      {slider("Ambience", "ambience")}
      {slider("Effects", "sfx")}
      {slider("Voices", "voice")}
    </div>
  );
}

// ---------------- dock ----------------
export function Dock({
  apps,
  openApps,
  bouncing,
  minned,
  onOpen,
  onFocusMin,
  onDrawer,
  mailBadge,
}: {
  apps: { app: string; title: string; icon: string }[];
  openApps: Set<string>;
  bouncing: Set<string>;
  minned: { id: string; title: string }[];
  onOpen: (app: string) => void;
  onFocusMin: (id: string) => void;
  onDrawer: () => void;
  mailBadge: number;
}) {
  return (
    <div class="dock-wrap">
      <div class="dock">
        {apps.map((a) => (
          <button
            key={a.app}
            class={`dock-icon ${bouncing.has(a.app) ? "bounce" : ""}`}
            title={a.title}
            onClick={() => onOpen(a.app)}
          >
            <span class={`dock-glyph dg-${a.app}`}>{a.icon}</span>
            {a.app === "mail" && mailBadge > 0 && <span class="dock-badge">{mailBadge}</span>}
            {openApps.has(a.app) && <span class="dock-dot" />}
          </button>
        ))}
        {minned.length > 0 && <span class="dock-sep" />}
        {minned.map((w) => (
          <button key={w.id} class="dock-icon dock-min" title={w.title} onClick={() => onFocusMin(w.id)}>
            <span class="dock-glyph dg-min">{w.title.slice(0, 2)}</span>
          </button>
        ))}
        <span class="dock-sep" />
        <button class="dock-icon" title="Desk Drawer — saves & settings" onClick={onDrawer}>
          <span class="dock-glyph dg-drawer">🗄</span>
        </button>
      </div>
    </div>
  );
}

// ---------------- toasts ----------------
export interface Toast {
  id: number;
  icon: string;
  title: string;
  body: string;
  onClick?: () => void;
}

export function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div class="toast-stack">
      {toasts.map((t) => (
        <div
          key={t.id}
          class="mac-toast"
          onClick={() => {
            t.onClick?.();
            dismiss(t.id);
          }}
        >
          <span class="toast-icon">{t.icon}</span>
          <span class="toast-text">
            <b>{t.title}</b>
            <span>{t.body}</span>
          </span>
          <button
            class="toast-x"
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
