// Recorded playsessions (deterministic decision-replay telemetry — PlayPen's session
// system, ported to BOB's turn-based kernel).
//   POST /api/sessions            -> player clients upload session chunks (public)
//   GET  /api/sessions            -> list session summaries (password-gated)
//   GET  /api/sessions?id=<id>    -> one full session, chunks assembled (gated)
//
// Storage layout in the SESSIONS KV namespace:
//   s:<id>:meta  -> full SessionMeta JSON; a terse subset rides in the KV key's
//                   *metadata* so the list endpoint costs zero GETs.
//   s:<id>:c<n>  -> chunk n: { decisions: [...] }; chunk 0 also carries `content`
//                   (the exact resolved Content bundle as played) and `seed`/`profile`,
//                   everything replaySession() needs, so a session is fully
//                   self-contained without cross-referencing /api/content history.
// Sessions expire after 90 days.

const TTL = 90 * 24 * 60 * 60;
const MAX_BODY = 6 * 1024 * 1024;
const LIST_LIMIT = 500;
const ID_RE = /^[a-z0-9-]{6,40}$/;

export async function onRequestPost({ request, env }) {
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ ok: false, error: "too large" }, 413);
    const body = JSON.parse(text);
    const id = String(body?.id ?? "");
    if (!ID_RE.test(id) || typeof body.seq !== "number" || !body.meta) {
      return json({ ok: false, error: "bad body" }, 400);
    }
    const seq = body.seq | 0;
    const chunk = { decisions: body.decisions ?? [], checkpoints: body.checkpoints ?? [] };
    if (seq === 0) {
      chunk.content = body.content ?? undefined;
      chunk.seed = body.meta.seed;
      chunk.profile = body.meta.profile;
    }
    await env.SESSIONS.put(`s:${id}:c${seq}`, JSON.stringify(chunk), { expirationTtl: TTL });
    await env.SESSIONS.put(`s:${id}:meta`, JSON.stringify({ ...body.meta, chunks: seq + 1 }), {
      expirationTtl: TTL,
      metadata: terseMeta(body.meta),
    });
    return json({ ok: true, id, seq });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  if (!env.EDITOR_PASSWORD) return json({ ok: false, error: "EDITOR_PASSWORD not configured" }, 500);
  const url = new URL(request.url);
  if ((url.searchParams.get("password") ?? "") !== env.EDITOR_PASSWORD) return json({ ok: false, error: "wrong password" }, 403);
  const id = url.searchParams.get("id");
  try {
    if (id) return await getSession(env, id);
    return await listSessions(env);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

/** ≤1024-byte summary stored as KV key metadata — powers the list view with zero GETs. */
function terseMeta(meta) {
  return {
    p: String(meta.pid ?? "").slice(0, 20),
    boss: String(meta.profile?.boss ?? "").slice(0, 24),
    studio: String(meta.profile?.studio ?? "").slice(0, 30),
    t: meta.startedAt,
    d: meta.endDay | 0,
    n: meta.decisions | 0,
    rel: meta.released | 0,
    g: String(meta.gameOverKind ?? "").slice(0, 12),
    e: String(meta.endReason ?? "").slice(0, 16),
    x: meta.tainted ? 1 : 0,
    v: meta.dev ? 1 : 0,
  };
}

async function listSessions(env) {
  const out = [];
  let cursor;
  while (out.length < LIST_LIMIT) {
    const page = await env.SESSIONS.list({ prefix: "s:", cursor, limit: 1000 });
    for (const key of page.keys) {
      if (!key.name.endsWith(":meta")) continue;
      out.push({ id: key.name.slice(2, -5), ...(key.metadata ?? {}) });
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  out.sort((a, b) => String(b.t ?? "").localeCompare(String(a.t ?? "")));
  return json({ ok: true, sessions: out.slice(0, LIST_LIMIT) });
}

async function getSession(env, id) {
  if (!ID_RE.test(id)) return json({ ok: false, error: "bad id" }, 400);
  const metaRaw = await env.SESSIONS.get(`s:${id}:meta`);
  if (!metaRaw) return json({ ok: false, error: "not found" }, 404);
  const meta = JSON.parse(metaRaw);
  const chunkCount = Math.max(1, meta.chunks | 0);
  const chunks = await Promise.all(Array.from({ length: chunkCount }, (_, i) => env.SESSIONS.get(`s:${id}:c${i}`)));
  let content = null, seed = null, profile = null;
  const decisions = [];
  const checkpoints = [];
  for (const raw of chunks) {
    if (!raw) continue;
    const c = JSON.parse(raw);
    if (c.content) content = c.content;
    if (c.seed !== undefined) seed = c.seed;
    if (c.profile !== undefined) profile = c.profile;
    if (Array.isArray(c.decisions)) decisions.push(...c.decisions);
    if (Array.isArray(c.checkpoints)) checkpoints.push(...c.checkpoints);
  }
  return json({ ok: true, meta, content, seed, profile, decisions, checkpoints });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
