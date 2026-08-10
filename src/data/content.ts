// ContentStore — bundled < published KV < local draft, PlayPen precedence.
// deepDefaults keeps stale drafts/publishes from dropping new schema fields.

import game from "../../content/game.json";
import people from "../../content/people.json";
import pitches from "../../content/pitches.json";
import setbacks from "../../content/setbacks.json";
import audience from "../../content/audience.json";
import economy from "../../content/economy.json";
import templates from "../../content/templates.json";
import meetings from "../../content/meetings.json";
import type { Content } from "../kernel/types";

export const FILES = ["game", "people", "pitches", "setbacks", "audience", "economy", "templates", "meetings"] as const;
export type ContentFile = (typeof FILES)[number];

const bundled: Record<ContentFile, any> = { game, people, pitches, setbacks, audience, economy, templates, meetings };

export function deepDefaults(target: any, defaults: any): any {
  if (target === undefined || target === null) return structuredClone(defaults);
  if (Array.isArray(target) || Array.isArray(defaults)) return target;
  if (typeof target !== "object" || typeof defaults !== "object") return target;
  const out: any = { ...target };
  for (const k of Object.keys(defaults)) out[k] = deepDefaults(target[k], defaults[k]);
  return out;
}

const DRAFT_KEY = "bob.contentDraft";

export function loadDraft(): Partial<Record<ContentFile, any>> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveDraft(draft: Partial<Record<ContentFile, any>>) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

export function assemble(published?: Partial<Record<ContentFile, any>>, draft?: Partial<Record<ContentFile, any>>): Content {
  const out: any = {};
  for (const f of FILES) {
    let v = structuredClone(bundled[f]);
    if (published?.[f]) v = deepDefaults(published[f], v);
    if (draft?.[f]) v = deepDefaults(draft[f], v);
    out[f] = v;
  }
  // templates nested under .banks in the schema Content expects flat access to
  return {
    game: out.game,
    people: out.people,
    pitches: out.pitches,
    setbacks: out.setbacks,
    audience: out.audience,
    economy: out.economy,
    templates: out.templates,
    meetings: out.meetings,
  };
}

export async function fetchPublished(): Promise<Partial<Record<ContentFile, any>> | undefined> {
  try {
    const res = await fetch("/api/content", { cache: "no-store" });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data?.files;
  } catch {
    return undefined;
  }
}

export function bundledContent(): Content {
  return assemble();
}
