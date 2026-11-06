// Calls to the Sealed Evals agent (served from the same origin in production).
const BASE = import.meta.env.VITE_API_URL || "";

async function handle(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return { body, text };
}

export async function apiGet(path) {
  return (await handle(await fetch(`${BASE}/api${path}`))).body;
}

/** Returns the raw response text too, so evidence can be hashed byte for byte. */
export async function apiGetRaw(path) {
  return handle(await fetch(`${BASE}/api${path}`));
}

export async function apiPost(path, data) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  return (await handle(res)).body;
}
