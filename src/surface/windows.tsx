// BossOS window manager: draggable, resizable, z-ordered windows over the office backdrop.
// Layout persists to localStorage. No surface ever takes over the whole screen.

import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

export interface WinState {
  id: string; // unique instance id (app name, or `${app}:${entityId}` for dossiers)
  app: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  min?: boolean;
  props?: Record<string, any>;
}

const LAYOUT_KEY = "bob.windows";

export function loadLayout(): WinState[] {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // default day-one layout: mail + calendar side by side, board below
  return [
    { id: "mail", app: "mail", title: "✉ BossMail", x: 12, y: 12, w: 560, h: 420, z: 1 },
    { id: "calendar", app: "calendar", title: "🗓 Calendar", x: 584, y: 12, w: 620, h: 300, z: 2 },
    { id: "board", app: "board", title: "🎬 Production Board", x: 584, y: 324, w: 620, h: 280, z: 3 },
  ];
}

export function saveLayout(wins: WinState[]) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(wins));
}

export function useWindows() {
  const [wins, setWins] = useState<WinState[]>(loadLayout);
  const winsRef = useRef(wins);
  winsRef.current = wins;
  useEffect(() => saveLayout(wins), [wins]);

  const topZ = () => Math.max(0, ...winsRef.current.map((w) => w.z)) + 1;

  const open = (app: string, title: string, opts: Partial<WinState> = {}) => {
    const id = opts.id ?? app;
    setWins((ws) => {
      const existing = ws.find((w) => w.id === id);
      if (existing) return ws.map((w) => (w.id === id ? { ...w, min: false, z: topZ() } : w));
      const cascade = (ws.length % 8) * 24;
      return [
        ...ws,
        {
          id,
          app,
          title,
          x: opts.x ?? 60 + cascade,
          y: opts.y ?? 40 + cascade,
          w: opts.w ?? 520,
          h: opts.h ?? 400,
          z: topZ(),
          props: opts.props,
        },
      ];
    });
  };
  const close = (id: string) => setWins((ws) => ws.filter((w) => w.id !== id));
  const focus = (id: string) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, z: topZ(), min: false } : w)));
  const minimize = (id: string) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, min: true } : w)));
  const move = (id: string, dx: number, dy: number) =>
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, x: Math.max(-w.w + 80, w.x + dx), y: Math.max(0, w.y + dy) } : w)));
  const resize = (id: string, dw: number, dh: number) =>
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, w: Math.max(300, w.w + dw), h: Math.max(180, w.h + dh) } : w)));
  return { wins, open, close, focus, minimize, move, resize };
}

export function Window({
  win,
  onClose,
  onFocus,
  onMinimize,
  onMove,
  onResize,
  badge,
  children,
}: {
  win: WinState;
  onClose: () => void;
  onFocus: () => void;
  onMinimize: () => void;
  onMove: (dx: number, dy: number) => void;
  onResize: (dw: number, dh: number) => void;
  badge?: string;
  children: ComponentChildren;
}) {
  const dragRef = useRef<{ mode: "move" | "resize"; lx: number; ly: number } | null>(null);

  const startDrag = (e: PointerEvent, mode: "move" | "resize") => {
    e.preventDefault();
    onFocus();
    dragRef.current = { mode, lx: e.clientX, ly: e.clientY };
    const onMoveEv = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.lx;
      const dy = ev.clientY - d.ly;
      d.lx = ev.clientX;
      d.ly = ev.clientY;
      if (d.mode === "move") onMove(dx, dy);
      else onResize(dx, dy);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMoveEv);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMoveEv);
    window.addEventListener("pointerup", onUp);
  };

  if (win.min) return null;
  return (
    <div class="win" style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }} onPointerDown={onFocus}>
      <div class="win-title" onPointerDown={(e) => startDrag(e as any, "move")}>
        <span class="win-name">
          {win.title}
          {badge ? <span class="win-badge">{badge}</span> : null}
        </span>
        <span class="win-btns" onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={onMinimize} title="minimize">–</button>
          <button onClick={onClose} title="close">✕</button>
        </span>
      </div>
      <div class="win-body">{children}</div>
      <div class="win-resize" onPointerDown={(e) => startDrag(e as any, "resize")} />
    </div>
  );
}
