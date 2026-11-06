const YOCTO = 10n ** 24n;

export function yoctoToNear(yocto, digits = 4) {
  const v = BigInt(yocto || "0");
  const whole = v / YOCTO;
  const frac = (v % YOCTO).toString().padStart(24, "0").slice(0, digits).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function nearToYocto(near) {
  const s = String(near).trim();
  if (!/^\d+(\.\d{0,24})?$/.test(s)) throw new Error("Enter an amount like 0.25");
  const [w, f = ""] = s.split(".");
  return (BigInt(w) * YOCTO + BigInt(f.padEnd(24, "0"))).toString();
}

export function addYocto(a, b) {
  return (BigInt(a) + BigInt(b)).toString();
}

export function pct(bps) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

export function short(s, head = 6, tail = 4) {
  if (!s) return "";
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function ago(ms) {
  const t = Number(ms);
  if (!t) return "";
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export async function sha256HexOf(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
