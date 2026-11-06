import { useState } from "react";
import { FileArrowUp, LockKey, Warning, CheckCircle, DownloadSimple } from "@phosphor-icons/react";
import { sealToTee, envelopeAad, sha256Hex, sealKeyReportData } from "@shared/envelope";
import { parseBenchmark, LIMITS } from "@shared/benchmark";
import { useAsync, useWallet } from "../lib/hooks";
import { apiGet, apiPost } from "../lib/api";
import { call, view, getConfig, connectWallet } from "../lib/near";
import { nearToYocto, short } from "../lib/format";
import { Button, Card, ErrorNote, Field, inputCls, Mono, Skeleton, LinkButton } from "../components/ui";

const STORAGE_DEPOSIT = "20000000000000000000000"; // 0.02 NEAR, unused part refunded

export default function Seal({ existingId }) {
  const { accountId } = useWallet();
  // The key we encrypt to comes from the chain: only an attested agent can publish it there,
  // so a tampered page or API can't swap in its own key. The API copy must agree with it.
  const sealKey = useAsync(async () => {
    const [k, info, agents] = await Promise.all([
      apiGet("/seal-key"),
      view("get_contract_info", {}),
      view("get_agents", { from_index: 0, limit: 20 }),
    ]);
    const valid = (agents ?? []).filter((a) => a.validity === "Valid");
    const chainKeys = await Promise.all(valid.map((a) => view("get_seal_key", { account_id: a.account_id })));
    const match = valid.find((a, i) => chainKeys[i] && chainKeys[i] === k.public_key);
    return {
      ...k,
      requiresTee: !!info?.requires_tee,
      onChain: !!match,
      agentId: match?.account_id ?? null,
      bindingOk: !!match && k.report_data === sealKeyReportData(k.public_key),
    };
  }, []);
  const existing = useAsync(async () => (existingId ? view("get_benchmark", { benchmark_id: existingId }) : null), [existingId]);

  const [file, setFile] = useState(null); // { name, bytes, hash, items }
  const [fileError, setFileError] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0.1");
  const [allowLeak, setAllowLeak] = useState(false);
  const [stage, setStage] = useState(null); // registering | encrypting | uploading
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function onFile(e) {
    setFileError(null);
    setFile(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > LIMITS.maxFileBytes) return setFileError(new Error("File is over 5 MB."));
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      const parsed = parseBenchmark(new TextDecoder().decode(bytes));
      setFile({ name: f.name, bytes, hash: sha256Hex(bytes), items: parsed.items.length });
      if (!name && parsed.name) setName(parsed.name.slice(0, 64));
    } catch (err) {
      setFileError(err);
    }
  }

  async function upload(benchmarkId, contractId) {
    setStage("encrypting");
    const envelope = sealToTee(file.bytes, sealKey.data.public_key, envelopeAad(contractId, benchmarkId));
    setStage("uploading");
    return apiPost(`/benchmarks/${benchmarkId}/upload`, envelope);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      if (!file) throw new Error("Choose a benchmark file first.");
      if (!sealKey.data) throw new Error("The agent's seal key is not available yet.");
      if (!sealKey.data.onChain) throw new Error("This key is not published on chain by a valid attested agent, so sealing is blocked.");
      if (!sealKey.data.bindingOk) throw new Error("The agent's quote does not commit to its seal key, so sealing is blocked.");
      const { contractId } = await getConfig();

      if (existingId) {
        if (!existing.data) throw new Error("Benchmark not found.");
        if (file.hash !== existing.data.set_hash) throw new Error("This file does not match the hash registered for this benchmark.");
        const res = await upload(existingId, contractId);
        setDone({ id: existingId, items: res.item_count });
        return;
      }

      if (!name.trim()) throw new Error("Give the benchmark a name.");
      const priceYocto = nearToYocto(price || "0");
      if (!accountId) await connectWallet();

      setStage("registering");
      const { value } = await call(
        "register_benchmark",
        { name: name.trim(), description: description.trim(), set_hash: file.hash, price: priceYocto, allow_leak_risk: allowLeak },
        STORAGE_DEPOSIT,
      );
      let id = value;
      if (id == null) {
        const me = (await import("../lib/near")).walletStore.get().accountId;
        const mine = ((await view("get_benchmarks", { from_index: 0, limit: 100 })) ?? []).filter(
          (b) => b.set_hash === file.hash && !b.sealed && b.author === me,
        );
        id = mine[mine.length - 1]?.id;
        if (!id) throw new Error("Registered, but the new id could not be read. Open it from the leaderboard to finish sealing.");
      }
      const res = await upload(id, contractId);
      setDone({ id, items: res.item_count });
    } catch (err) {
      setError(err);
    } finally {
      setStage(null);
    }
  }

  if (done) {
    return (
      <section className="mx-auto mt-12 max-w-3xl px-4 pt-24">
        <Card className="flex flex-col items-start gap-4 p-8">
          <CheckCircle size={32} className="text-sealed" aria-hidden />
          <h1 className="heading-5">Benchmark sealed</h1>
          <p className="body-6 text-muted">
            {done.items} items are now held inside the TEE, and the chain records that the attested agent holds a file
            matching your hash. Every paid run sends the price to you.
          </p>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`#/benchmark/${done.id}`}>View benchmark</LinkButton>
            <LinkButton href={`#/run?benchmark=${done.id}`} variant="secondary">Run it now</LinkButton>
          </div>
        </Card>
      </section>
    );
  }

  const stageLabel = { registering: "Confirm in your wallet", encrypting: "Encrypting in your browser", uploading: "Sending to the TEE" }[stage];

  return (
    <section className="mx-auto mt-12 max-w-3xl px-4 pt-24">
      <h1 className="mb-2 heading-4 md:heading-3">{existingId ? `Finish sealing benchmark #${existingId}` : "Seal a benchmark"}</h1>
      <p className="mb-8 body-6 text-muted">
        Your file is encrypted here in the browser to a key that only exists inside the TEE. The chain only ever sees its
        hash. Once sealed, you earn your price every time someone runs it.
      </p>

      <SealKeyCard sealKey={sealKey} />

      <Card className="mt-4 p-6">
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <Field
            label="Benchmark file"
            hint={
              <>
                JSON with an items array of prompt and answer pairs, up to 2,000 items (this agent runs up to 500 per eval).{" "}
                <a href="/sample-benchmark.json" download className="inline-flex items-center gap-1 text-ink underline">
                  <DownloadSimple size={12} aria-hidden /> Practice file
                </a>{" "}
                (public, so only for trying the flow).
              </>
            }
          >
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line bg-void px-4 py-4 transition duration-300 ease-weighted hover:border-[#4a4a4a]">
              <FileArrowUp size={24} className="text-muted" aria-hidden />
              <span className="flex flex-col">
                <span className="body-5">{file ? file.name : "Choose a .json file"}</span>
                <span className="caption-5 text-muted">
                  {file ? `${file.items} items · sha256 ${short(file.hash, 10, 6)}` : "It stays on this device until it is encrypted"}
                </span>
              </span>
              <input type="file" accept="application/json,.json" className="sr-only" onChange={onFile} />
            </label>
            <ErrorNote error={fileError} />
          </Field>

          {existingId ? (
            existing.data ? (
              <p className="rounded-lg bg-void p-4 caption-2 text-muted">
                {existing.data.name} expects a file with hash <Mono className="text-ink">{existing.data.set_hash}</Mono>
              </p>
            ) : (
              <Skeleton className="h-16 w-full" />
            )
          ) : (
            <>
              <Field label="Name" hint="Shown on the leaderboard, up to 64 characters.">
                <input className={inputCls} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="Grade school math, held out" />
              </Field>
              <Field label="Description" hint="Optional. Say what it measures, never what it asks.">
                <textarea className={`${inputCls} min-h-24`} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <Field label="Price per run in NEAR" hint="Paid to you each time a score settles. Use 0 for a free benchmark.">
                <input className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.trim())} />
              </Field>
              <label className="flex items-start gap-3 rounded-lg border border-line p-4">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[#f5b65b]" checked={allowLeak} onChange={(e) => setAllowLeak(e.target.checked)} />
                <span className="flex flex-col gap-1">
                  <span className="title-4">Allow leak risk runs</span>
                  <span className="caption-5 text-muted">
                    Lets people test closed API models. Those providers will see your questions, and results are labeled
                    Leak risk. Leave this off to keep the set fully sealed.
                  </span>
                </span>
              </label>
            </>
          )}

          <ErrorNote error={error} />

          <div className="flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
            <span className="caption-2 text-muted">{stageLabel ?? (existingId ? "No transaction needed" : "One transaction, about 0.01 NEAR for storage")}</span>
            <Button type="submit" busy={!!stage} disabled={!file || !sealKey.data}>
              <LockKey size={16} weight="bold" aria-hidden />
              {existingId ? "Encrypt and upload" : "Register and seal"}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

function SealKeyCard({ sealKey }) {
  if (sealKey.loading && !sealKey.data) return <Skeleton className="h-24 w-full" />;
  if (sealKey.error) return <ErrorNote error={sealKey.error} />;
  const k = sealKey.data;
  const local = k.tee_mode !== "tee" || !k.requiresTee;
  return (
    <Card className={`flex flex-col gap-2 p-4 ${local ? "border-leak/40" : ""}`}>
      <span className={`inline-flex items-center gap-2 title-4 ${local ? "text-leak" : "text-sealed"}`}>
        {local ? <Warning size={16} aria-hidden /> : <LockKey size={16} aria-hidden />}
        {local
          ? "Local test agent, not in a TEE. Do not seal real benchmarks here."
          : k.onChain
            ? "Encrypting to the key the attested agent published on chain"
            : "This key is not published on chain by a valid agent. Sealing is blocked."}
      </span>
      <span className="caption-5 text-muted">
        Key <Mono className="text-ink">{short(k.public_key, 12, 12)}</Mono>
        {k.onChain ? ` · published on chain by ${short(k.agentId, 8, 6)}` : " · not on chain"}
        {" · "}
        <a href="#/trust" className="underline hover:text-ink">verify it yourself</a>
      </span>
    </Card>
  );
}
