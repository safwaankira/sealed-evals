import { useAsync } from "../lib/hooks";
import { view } from "../lib/near";
import { bestPerModel } from "../lib/data";
import { yoctoToNear, ago, pct } from "../lib/format";
import { Card, ErrorNote, LinkButton, ModeBadge, Mono, Skeleton, StatusBadge } from "../components/ui";
import Leaderboard from "../components/Leaderboard";

export default function BenchmarkPage({ id }) {
  const d = useAsync(async () => {
    const b = await view("get_benchmark", { benchmark_id: id });
    if (!b) throw new Error(`Benchmark #${id} does not exist.`);
    const evals = (await view("get_benchmark_evals", { benchmark_id: id, from_index: 0, limit: 100 })) ?? [];
    return { b, evals };
  }, [id], { pollMs: 10000 });

  if (!d.data) {
    return (
      <section className="mx-auto mt-12 flex max-w-6xl flex-col gap-4 px-4 pt-24">
        {d.error ? <ErrorNote error={d.error} /> : <><Skeleton className="h-10 w-72" /><Skeleton className="h-40 w-full" /></>}
      </section>
    );
  }
  const { b, evals } = d.data;
  return (
    <section className="mx-auto mt-12 flex max-w-6xl flex-col gap-8 px-4 pt-24">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <span className="caption-4 text-muted">Benchmark #{b.id} · registered {ago(b.created_ms)}</span>
          <h1 className="heading-4 md:heading-3">{b.name}</h1>
          {b.description ? <p className="max-w-[680px] body-6 text-muted">{b.description}</p> : null}
        </div>
        {b.sealed && b.active ? <LinkButton href={`#/run?benchmark=${b.id}`}>Run this benchmark</LinkButton> : null}
      </div>

      <Card className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Hidden items" value={b.item_count || "not sealed yet"} />
        <Stat label="Price per run" value={`${yoctoToNear(b.price)} NEAR`} />
        <Stat label="Runs" value={b.runs} />
        <Stat label="Earned by author" value={`${yoctoToNear(b.earned)} NEAR`} />
        <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
          <span className="caption-4 text-muted">Sealed file hash</span>
          <Mono className="caption-2">{b.set_hash}</Mono>
          <span className="caption-5 text-muted">
            {b.sealed ? `Held by attested agent ${b.sealed_by}` : "Waiting for the author to upload the encrypted file. "}
            {!b.sealed ? <a className="underline hover:text-ink" href={`#/seal?id=${b.id}`}>Finish sealing</a> : null}
            {" · "}leak risk runs {b.allow_leak_risk ? "allowed" : "not allowed"}
          </span>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <h2 className="heading-6">Best score per model</h2>
        <Leaderboard rows={[{ benchmark: b, results: bestPerModel(evals) }]} />
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="heading-6">All runs</h2>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead className="caption-4 text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-3 font-medium">Eval</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Score</th>
              </tr>
            </thead>
            <tbody className="body-6">
              {[...evals].reverse().map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0 hover:bg-raised">
                  <td className="px-4 py-3"><a className="underline" href={`#/eval/${e.id}`}>#{e.id}</a></td>
                  <td className="max-w-64 truncate px-4 py-3">{e.model}</td>
                  <td className="px-4 py-3"><span className="flex items-center gap-2"><StatusBadge status={e.status} />{e.result ? <ModeBadge mode={e.result.mode} size="sm" /> : null}</span></td>
                  <td className="px-4 py-3 text-right font-mono">{e.result ? pct(e.result.score_bps) : "·"}</td>
                </tr>
              ))}
              {!evals.length ? (
                <tr><td colSpan={4} className="px-4 py-6 text-muted">No runs yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      </div>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="caption-4 text-muted">{label}</span>
      <span className="font-mono heading-6">{value}</span>
    </div>
  );
}
