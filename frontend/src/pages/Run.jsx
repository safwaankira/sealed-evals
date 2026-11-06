import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Info } from "@phosphor-icons/react";
import { useAsync, useWallet } from "../lib/hooks";
import { call, view, getConfig, connectWallet } from "../lib/near";
import { apiGet } from "../lib/api";
import { addYocto, yoctoToNear, short } from "../lib/format";
import { Button, Card, ErrorNote, Field, inputCls, Skeleton } from "../components/ui";

// Covers the eval's storage; anything unused is refunded by the contract in the same transaction
const STORAGE_BUFFER = "20000000000000000000000"; // 0.02 NEAR

export default function Run({ preselect }) {
  const { accountId } = useWallet();
  const benchmarks = useAsync(async () => {
    const list = (await view("get_benchmarks", { from_index: 0, limit: 100 })) ?? [];
    return list.filter((b) => b.sealed && b.active);
  }, []);
  const models = useAsync(async () => (await apiGet("/models")).models ?? [], []);

  const [benchmarkId, setBenchmarkId] = useState(preselect ?? "");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!benchmarkId && benchmarks.data?.length) setBenchmarkId(benchmarks.data[0].id);
  }, [benchmarks.data, benchmarkId]);

  const b = useMemo(() => benchmarks.data?.find((x) => x.id === benchmarkId), [benchmarks.data, benchmarkId]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!b) return setError(new Error("Pick a benchmark."));
    if (!/^[A-Za-z0-9\-_./:@]{1,128}$/.test(model)) return setError(new Error("Pick a model, or type a valid NEAR AI model id."));
    setBusy(true);
    try {
      if (!accountId) await connectWallet();
      const { value } = await call("request_eval", { benchmark_id: b.id, model }, addYocto(b.price, STORAGE_BUFFER));
      let id = value;
      if (id == null) {
        // some wallets don't hand back the return value; find our newest request instead
        const { contractId } = await getConfig();
        const recent = (await view("get_evals", { from_index: 0, limit: 20 })) ?? [];
        id = recent.find((x) => x.model === model && x.benchmark_id === b.id)?.id;
        if (!id) throw new Error(`Request sent to ${contractId}, but its id could not be read. Check the leaderboard shortly.`);
      }
      window.location.hash = `#/eval/${id}`;
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto mt-12 max-w-3xl px-4 pt-24">
      <h1 className="mb-2 heading-4 md:heading-3">Run an eval</h1>
      <p className="mb-8 body-6 text-muted">
        Pick a sealed benchmark and a model. You pay the author's price, the TEE runs the hidden questions and the score
        settles on chain. If the run can't happen, you get a full refund.
      </p>

      <Card className="p-6">
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <Field label="Benchmark">
            {benchmarks.loading && !benchmarks.data ? (
              <Skeleton className="h-10 w-full" />
            ) : benchmarks.data?.length ? (
              <select className={inputCls} value={benchmarkId} onChange={(e) => setBenchmarkId(e.target.value)}>
                {benchmarks.data.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {x.item_count} items · {yoctoToNear(x.price)} NEAR
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-lg bg-raised px-3 py-3 body-6 text-muted">
                No sealed benchmarks yet. <a href="#/seal" className="text-ink underline">Seal one first.</a>
              </p>
            )}
          </Field>

          {b ? (
            <div className="grid gap-2 rounded-lg bg-void p-4 caption-2 text-muted sm:grid-cols-2">
              <span>Author: <span className="font-mono text-ink">{short(b.author, 16, 8)}</span></span>
              <span>Runs so far: <span className="text-ink">{b.runs}</span></span>
              <span className="sm:col-span-2">
                Leak risk runs:{" "}
                <span className={b.allow_leak_risk ? "text-leak" : "text-sealed"}>
                  {b.allow_leak_risk ? "allowed by the author" : "not allowed, only attested models will run"}
                </span>
              </span>
              {b.description ? <span className="sm:col-span-2 text-ink">{b.description}</span> : null}
            </div>
          ) : null}

          <Field
            label="Model"
            hint="Models served from NEAR AI Cloud TEEs run Sealed. The agent checks this with a fresh attestation before sending anything."
          >
            {models.loading && !models.data ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <>
                <input
                  className={inputCls}
                  list="models"
                  placeholder="Choose or type a NEAR AI model id"
                  value={model}
                  onChange={(e) => setModel(e.target.value.trim())}
                  autoComplete="off"
                />
                <datalist id="models">
                  {(models.data ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.owned_by ? `${m.owned_by}` : ""}
                    </option>
                  ))}
                </datalist>
                {models.error ? <span className="caption-5 text-leak">Model list unavailable. You can still type a model id.</span> : null}
              </>
            )}
          </Field>

          <ErrorNote error={error} />

          <div className="flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2 caption-2 text-muted">
              <Info size={16} aria-hidden />
              {b ? `${yoctoToNear(b.price)} NEAR plus about 0.01 NEAR storage, unused part refunded` : "Select a benchmark"}
            </span>
            <Button type="submit" busy={busy} disabled={!b}>
              {accountId ? "Pay and run" : "Connect and run"}
              <ArrowRight size={16} weight="bold" aria-hidden />
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
