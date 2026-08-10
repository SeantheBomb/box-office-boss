// Published content: GET serves the latest bundle, POST publishes a new version.
// KV binding: CONTENT. Secret: EDITOR_PASSWORD (Pages env).

const KEY_LATEST = "content:latest";

export async function onRequestGet({ env }) {
  const raw = await env.CONTENT?.get(KEY_LATEST);
  if (!raw) return json({ files: null, version: 0 });
  return new Response(raw, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
  if (!env.EDITOR_PASSWORD) return json({ error: "EDITOR_PASSWORD not configured" }, 500);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (body.password !== env.EDITOR_PASSWORD) return json({ error: "wrong password" }, 403);
  if (!body.files || typeof body.files !== "object") return json({ error: "no files" }, 400);

  const prevRaw = await env.CONTENT.get(KEY_LATEST);
  const prev = prevRaw ? JSON.parse(prevRaw) : { files: {}, version: 0 };
  const files = { ...prev.files, ...body.files }; // per-file merge: unpublished files keep their live copy
  const version = (prev.version ?? 0) + 1;
  const record = { files, version, publishedAt: new Date().toISOString() };
  await env.CONTENT.put(KEY_LATEST, JSON.stringify(record));
  await env.CONTENT.put(`content:v${version}`, JSON.stringify(record)); // history for manual restore
  return json({ ok: true, version });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
