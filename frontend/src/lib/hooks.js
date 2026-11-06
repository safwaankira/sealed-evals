import { useEffect, useRef, useState, useSyncExternalStore, useCallback } from "react";
import { walletStore } from "./near";

/** Hash routes: #/, #/run, #/seal, #/eval/12, #/benchmark/3, #/trust */
export function useRoute() {
  const read = () => {
    const raw = window.location.hash.replace(/^#/, "") || "/";
    const [path, query = ""] = raw.split("?");
    return { path, parts: path.split("/").filter(Boolean), query: new URLSearchParams(query) };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function useWallet() {
  return useSyncExternalStore(walletStore.subscribe, walletStore.get);
}

/** Load async data; re-run when deps change; optional polling. */
export function useAsync(fn, deps = [], { pollMs = 0 } = {}) {
  const [s, setS] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const load = useCallback(async (silent) => {
    if (!silent) setS((p) => ({ ...p, loading: true }));
    try {
      const data = await fnRef.current();
      setS({ data, error: null, loading: false });
    } catch (error) {
      setS((p) => ({ data: p.data, error, loading: false }));
    }
  }, []);
  useEffect(() => {
    load(false);
    if (!pollMs) return;
    const t = setInterval(() => load(true), pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ...s, reload: () => load(true) };
}

/** Rise and fade sections in once as they enter the viewport. */
export function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
