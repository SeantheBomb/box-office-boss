// Save = seed + decision log + state snapshot + per-stream RNG states.
// Snapshot is authoritative for loading; seed+log enables replay debugging.

import type { RunState } from "./types";
import { Sim } from "./sim";
import type { Content } from "./types";

export interface SaveFile {
  version: 1;
  savedAt: number; // sim day
  state: RunState;
  rngStates: Record<string, number>;
}

const SAVE_KEY = "bob.save";

export function serialize(sim: Sim): SaveFile {
  return {
    version: 1,
    savedAt: sim.state.day,
    state: sim.state,
    rngStates: sim.rng.serialize(),
  };
}

export function saveLocal(sim: Sim) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(sim)));
}

export function loadLocal(content: Content): Sim | undefined {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return undefined;
  try {
    const file = JSON.parse(raw) as SaveFile;
    return new Sim(content, file.state, file.rngStates);
  } catch {
    return undefined;
  }
}

export function clearLocal() {
  localStorage.removeItem(SAVE_KEY);
}

export function exportSave(sim: Sim): string {
  return JSON.stringify(serialize(sim), null, 2);
}

export function importSave(content: Content, json: string): Sim {
  const file = JSON.parse(json) as SaveFile;
  if (!file.state || file.version !== 1) throw new Error("Not a Box Office Boss save");
  return new Sim(content, file.state, file.rngStates);
}
