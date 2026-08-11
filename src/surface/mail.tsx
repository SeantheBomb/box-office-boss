// BossMail: filters, search, unread vs NEEDS-REPLY distinction, type icons, dossier links.

import { useState } from "preact/hooks";
import type { Sim } from "../kernel/sim";
import type { Email } from "../kernel/types";
import { calDate, DOW } from "../kernel/types";
import { StandingsChart, FunnelReport } from "./reports";
import type { OpenDossier } from "./dossiers";

const ROLE_ICON: Record<string, string> = {
  writer: "✍",
  producer: "🎬",
  trade: "📰",
  board: "👔",
  distribution: "📀",
  critic: "⭐",
};

type Filter = "all" | "reply" | "unread" | "writer" | "producer" | "trade" | "board" | "distribution" | "critic";

export function MailApp({ sim, bump, openDossier }: { sim: Sim; bump: () => void; openDossier: OpenDossier }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selId, setSelId] = useState<string | undefined>();
  const inbox = sim.state.inbox;
  const needsReply = (e: Email) => e.actions.length > 0 && !e.actionTaken;
  const filtered = inbox.filter((e) => {
    if (filter === "reply" && !needsReply(e)) return false;
    if (filter === "unread" && e.read) return false;
    if (!["all", "reply", "unread"].includes(filter) && e.fromRole !== filter) return false;
    if (search && !(e.subject + " " + e.from + " " + e.body).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const sel = inbox.find((e) => e.id === selId) ?? filtered[0];
  const replyCount = inbox.filter(needsReply).length;
  const unreadCount = inbox.filter((e) => !e.read).length;
  return (
    <div class="mail">
      <div class="mail-toolbar">
        {(
          [
            ["all", `All`],
            ["reply", `⚡ Needs Reply (${replyCount})`],
            ["unread", `● Unread (${unreadCount})`],
            ["writer", "✍"],
            ["producer", "🎬"],
            ["trade", "📰"],
            ["board", "👔"],
            ["critic", "⭐"],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button key={f} class={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
        <input placeholder="search…" value={search} onInput={(e) => setSearch((e.target as HTMLInputElement).value)} />
      </div>
      <div class="mail-split">
        <div class="inbox-list">
          {filtered.map((e) => (
            <div
              key={e.id}
              class={`item ${e.read ? "" : "unread"} ${sel?.id === e.id ? "sel" : ""} ${needsReply(e) ? "needs-reply" : ""}`}
              onClick={() => {
                e.read = true;
                setSelId(e.id);
                bump();
              }}
            >
              <div class="from">
                {ROLE_ICON[e.fromRole] ?? "✉"} {e.from}
                {needsReply(e) && <span class="reply-chip">REPLY</span>}
              </div>
              {e.subject}
            </div>
          ))}
          {!filtered.length && <div style={{ padding: 12, color: "#5a636e" }}>Nothing here. Enjoy it while it lasts.</div>}
        </div>
        {sel ? <ReadPane sim={sim} email={sel} bump={bump} openDossier={openDossier} /> : <div class="inbox-empty">Select a message</div>}
      </div>
    </div>
  );
}

function ReadPane({ sim, email, bump, openDossier }: { sim: Sim; email: Email; bump: () => void; openDossier: OpenDossier }) {
  const d = calDate(email.day);
  const funnelMovie = email.embed?.kind === "funnel" ? sim.movie(email.embed.movieId) : undefined;
  const ctxMovie = sim.movie(email.ctx.movieId);
  const ctxPerson = sim.person(email.ctx.writerId ?? email.ctx.producerId ?? email.ctx.castId);
  return (
    <div class="inbox-read">
      <h3>{email.subject}</h3>
      <div class="meta">
        {email.from} · {DOW[d.dayOfWeek]} wk{d.week} yr{d.year}
        {ctxMovie && (
          <>
            {" · "}
            <a class="doss-link" onClick={() => openDossier("movie", ctxMovie.id)}>📁 {ctxMovie.title}</a>
          </>
        )}
        {ctxPerson && (
          <>
            {" · "}
            <a class="doss-link" onClick={() => openDossier("person", ctxPerson.id)}>👤 {ctxPerson.name}</a>
          </>
        )}
      </div>
      <div class="body">{email.body}</div>
      {email.embed?.kind === "standings" && (
        <div style={{ background: "#faf6ec", color: "#1c1a17", padding: 8, marginTop: 10 }}>
          <StandingsChart sim={sim} compact />
        </div>
      )}
      {funnelMovie && (
        <div style={{ background: "#faf6ec", color: "#1c1a17", padding: 8, marginTop: 10 }}>
          <FunnelReport sim={sim} movie={funnelMovie} />
        </div>
      )}
      {email.actions.length > 0 && !email.actionTaken && (
        <div class="actions">
          {email.actions.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                sim.emailAction(email.id, a.id);
                bump();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {email.actionTaken && <div class="taken">↳ You replied: {email.actions.find((a) => a.id === email.actionTaken)?.label ?? email.actionTaken}</div>}
    </div>
  );
}
