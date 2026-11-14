import { ArrowRight, Trophy } from "@phosphor-icons/react";
import { Card, ModeBadge, Skeleton, LinkButton, Reveal } from "./ui";
import { pct, ago, yoctoToNear, short } from "../lib/format";

export default function Leaderboard({ rows, loading, compact = false }) {
  if (loading) {
    return (
      <Card className="flex flex-col gap-4 p-6">
        <Skeleton className="h-6 w-48" />
        {[0, 1, 2].map((j) => (
          <Skeleton key={j} className="h-12 w-full" />
        ))}
      </Card>
    );
  }
  const sealed = compact ? (rows ?? []).filter((r) => r.benchmark.sealed && r.benchmark.active) : rows ?? [];
  if (!sealed.length) {
    return (
      <Card className="flex flex-col items-start gap-4 p-8">
        <Trophy size={28} className="text-muted" aria-hidden />
        <div className="flex flex-col gap-1">
          <h3 className="heading-6">No sealed benchmarks yet</h3>
          <p className="body-6 text-muted">Seal the first one. It takes one transaction and the file never leaves your browser unencrypted.</p>
        </div>
        <LinkButton href="#/seal" variant="secondary">
          Seal a benchmark
        </LinkButton>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {sealed.map(({ benchmark: b, results }) => (
        <Reveal as="div" key={b.id} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <a href={`#/benchmark/${b.id}`} className="heading-6 transition duration-300 ease-weighted hover:text-muted">
                {b.name}
              </a>
              <span className="caption-5 text-muted">
                {b.item_count} hidden questions · {yoctoToNear(b.price)} NEAR per run to {short(b.author, 14, 8)}
              </span>
            </div>
            <a
              href={`#/run?benchmark=${b.id}`}
              className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-2 button-sm transition duration-300 ease-weighted hover:bg-hover active:scale-[0.98]"
            >
              Score a model on it <ArrowRight size={14} weight="bold" aria-hidden />
            </a>
          </div>

          {results.length ? (
            <ol className="flex flex-col rounded-2xl border border-line bg-surface p-2">
              {(compact ? results.slice(0, 5) : results).map((e, i) => {
                const sealedRun = e.result.mode === "Sealed";
                return (
                  <li key={e.id}>
                    <a
                      href={`#/eval/${e.id}`}
                      className="grid grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg px-3 py-3 transition duration-300 ease-weighted hover:bg-raised md:grid-cols-[32px_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
                    >
                      <span className={`tnum font-mono body-4 ${i === 0 ? "text-sealed" : "text-faint"}`}>{String(i + 1).padStart(2, "0")}</span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate body-5">{e.model}</span>
                        <span className="caption-5 text-muted">
                          {e.result.verified_responses}/{e.result.total} answers signed · {ago(e.result.completed_ms)}
                        </span>
                      </span>
                      <span className="hidden h-2 overflow-hidden rounded-sm bg-hover md:block" aria-hidden>
                        <span
                          className={`bar block h-full rounded-sm ${sealedRun ? "bg-sealed" : "bg-leak"}`}
                          style={{ width: `${e.result.score_bps / 100}%` }}
                        />
                      </span>
                      <span className="flex items-center gap-3">
                        <ModeBadge mode={e.result.mode} size="sm" />
                        <span className="tnum w-16 text-right font-mono body-1">{pct(e.result.score_bps)}</span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="rounded-2xl border border-line bg-surface px-4 py-6 body-6 text-muted">
              No scores yet. <a className="text-ink underline" href={`#/run?benchmark=${b.id}`}>Run the first eval.</a>
            </p>
          )}
          {compact && results.length > 5 ? (
            <a href={`#/benchmark/${b.id}`} className="inline-flex items-center gap-1 caption-1 text-muted hover:text-ink">
              All {results.length} results <ArrowRight size={12} aria-hidden />
            </a>
          ) : null}
        </Reveal>
      ))}
    </div>
  );
}
