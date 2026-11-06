import { view } from "./near";

/** Every benchmark with its completed results, best run per model first. */
export async function loadBoard() {
  const benchmarks = (await view("get_benchmarks", { from_index: 0, limit: 100 })) ?? [];
  const rows = await Promise.all(
    benchmarks.map(async (b) => {
      const evals = (await view("get_benchmark_evals", { benchmark_id: b.id, from_index: 0, limit: 100 })) ?? [];
      return { benchmark: b, evals, results: bestPerModel(evals) };
    }),
  );
  const paid = benchmarks.reduce((s, b) => s + BigInt(b.earned || "0"), 0n).toString();
  const runs = benchmarks.reduce((s, b) => s + b.runs, 0);
  return { rows, stats: { benchmarks: benchmarks.filter((b) => b.sealed).length, runs, paid } };
}

export function bestPerModel(evals) {
  const done = evals.filter((e) => e.status === "Completed" && e.result);
  const best = new Map();
  for (const e of done) {
    const key = `${e.model}|${e.result.mode}`;
    const prev = best.get(key);
    if (!prev || e.result.score_bps > prev.result.score_bps) best.set(key, e);
  }
  return [...best.values()].sort(
    (a, b) =>
      // sealed results rank above leak risk ones, then by score
      (a.result.mode === "Sealed" ? 0 : 1) - (b.result.mode === "Sealed" ? 0 : 1) ||
      b.result.score_bps - a.result.score_bps,
  );
}
