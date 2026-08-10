# Box Office Boss — project conventions

Satirical Hollywood studio sim. Diagetic DOM/CSS UI, fully procedural world, real-time
calendar with pause. Vite + TS + Preact; Cloudflare Pages + KV. Design doc:
`docs/DESIGN.md` (read it before changing systems — it's the contract).

## The one rule (inherited from PlayPen)

**All design data lives in `content/*.json` — never hardcode gameplay values, names, or
lines in `src/`.** The game is fully procedural: the editor (Ctrl+Shift+E) edits
*generators and template banks*, never world instances. New flavor = new bank lines; new
tuning = new content field (+ editor visibility).

## Architecture

- `src/kernel/` — headless deterministic sim. ZERO DOM imports. Everything reaches it
  through ContentStore (`src/data/content.ts`: bundled < published KV < localStorage
  draft, deep-merged so stale drafts never drop new schema fields).
- `src/surface/` — Preact scenes (office/inbox, calendar wall, reports corner, meeting
  scenes). `src/editor/` — hidden editor with JSON tabs, generator previews, Sim Lab,
  publish.
- Calendar: 4 seasons × 12 weeks × 7 days (336-day year). Two event kinds only:
  **meetings** (dialogue encounters — outcome is *their* decision) and **outcomes**
  (auto-resolve → email). Email replies are the player's decision surface.
- Meetings: `src/kernel/meetings.ts` MeetingSession state machines; dialogue lines and
  reactions come from `content/meetings.json` + `content/templates.json` banks.

## Determinism (non-negotiable)

- Named RNG streams via `RngBank` (`rng.get("audience")`, `"setbacks"`, `"dialogue"`…).
  New randomness = NEW named stream, never extra draws on an existing one (save compat).
- No `Date.now()`/`Math.random()` in kernel code. Seed handling stays in the surface.
- Save = seed + decision log + state snapshot + per-stream RNG states
  (`src/kernel/save.ts`). `tests/kernel.test.ts` pins same-seed identity — keep it green.

## Testing / verification

- `npm test` — Vitest asserts design requirements (determinism, funnel monotonicity,
  full-loop releases, rival activity, idle-player fail state, no `[missing bank:]` leaks).
  When Sean states a design requirement, encode it as a test FIRST.
- `npm run dev` then drive via `window.BOB` debug handle: `BOB.sim()`, `BOB.skipDays(n)`
  (queues meetings into the UI like real time passing). Scripted playtests: click
  `.dialogue .choices button` / `.continue` in a loop — see the 2-year drive in the
  2026-08-10 session.
- Balance: editor → 🧪 Sim Lab runs headless multi-seed batches with the disciplined
  autopilot (`src/kernel/autopilot.ts`). Target: disciplined play survives; greenlight-
  everything goes bankrupt (that's design, not a bug).

## Cloud content

- Published bundle in KV (`bob_content` namespace, binding `CONTENT`) via
  `functions/api/content.js`: GET serves latest, POST publishes (per-file merge, version
  history rows `content:vN`). Gated by `EDITOR_PASSWORD` Pages secret — never hardcode.
- Players load published over bundled on boot; editor drafts overlay both locally.
- Deploy: `npm run deploy` (build + `wrangler pages deploy dist`). Project:
  `box-office-boss`, production branch `master`, https://box-office-boss.pages.dev

## Tone (PG-13 sharp — see DESIGN.md §13)

Deadpan paperwork, unhinged people. Specificity is the joke ("his chiropractor's" beats
"medical staff"). Madlib slots drop concrete sim facts into absurd frames. No profanity.
Tone tiers (warm/curt/cold/hostile) keyed to relationship/board patience are the game's
main emotional instrument — every new sender-role bank should ship all tiers it needs.

## Style

- No image/audio assets: procedural SVG portraits (`src/surface/portraits.tsx`),
  CSS-gradient scenes. Keep it that way until Sean says otherwise.
- Commit messages: descriptive Title-Case noun phrases.
