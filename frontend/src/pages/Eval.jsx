import { useEffect, useState } from "react";
import { verifyMessage } from "ethers";
import { CheckCircle, XCircle, CircleNotch, ArrowSquareOut, DownloadSimple, ArrowLeft, ArrowRight, ArrowCounterClockwise } from "@phosphor-icons/react";
import { useAsync, useWallet } from "../lib/hooks";
import { view, call, getConfig, explorerAccount } from "../lib/near";
import { apiGetRaw } from "../lib/api";
import { pct, ago, yoctoToNear, short, sha256HexOf } from "../lib/format";
import { Button, Card, ErrorNote, LinkButton, ModeBadge, Mono, Skeleton, StatusBadge, SignatureGrid } from "../components/ui";

const TIMEOUT_MS = 60 * 60 * 1000;

export default function EvalPage({ id }) {
  const { accountId } = useWallet();
  const ev = useAsync(async () => {
    const e = await view("get_eval", { eval_id: id });
    if (!e) throw new Error(`Eval #${id} does not exist.`);
    const b = await view("get_benchmark", { benchmark_id: e.benchmark_id });
    return { e, b };
  }, [id], { pollMs: 4000 });

  if (ev.loading && !ev.data) {
    return (
      <section className="mx-auto flex mt-12 max-w-4xl flex-col gap-4 px-4 pt-24">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }
  if (!ev.data) {
    return (
      <section className="mx-auto mt-12 max-w-4xl px-4 pt-24">
        <ErrorNote error={ev.error} />
      </section>
    );
  }
  const { e, b } = ev.data;
  const r = e.result;

  return (
    <section className="mx-auto flex mt-12 max-w-4xl flex-col gap-4 px-4 pt-24">
      <a href="#/" className="inline-flex w-fit items-center gap-1 caption-1 text-muted transition duration-300 ease-weighted hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Leaderboard
      </a>
      <div className="flex flex-col gap-4 pb-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="caption-4 text-muted">
            Eval #{e.id} · <a className="underline hover:text-ink" href={`#/benchmark/${b.id}`}>{b.name}</a> · requested {ago(e.created_ms)}
          </span>
          <h1 className="heading-5 break-all md:heading-4">{e.model}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={e.status} />
            {r ? <ModeBadge mode={r.mode} /> : null}
          </div>
        </div>
        {e.status !== "Pending" && b.sealed && b.active ? (
          <LinkButton href={`#/run?benchmark=${b.id}`} className="shrink-0 self-start md:self-auto">
            Run another model
            <ArrowRight size={16} weight="bold" aria-hidden />
          </LinkButton>
        ) : null}
      </div>

      {e.status === "Pending" ? <PendingCard e={e} accountId={accountId} onReclaimed={ev.reload} /> : null}
      {e.status === "Failed" || e.status === "Refunded" ? (
        <Card className="flex flex-col gap-2 p-6">
          <span className="title-3">No score was recorded</span>
          <p className="body-6 text-muted">{e.failure_reason}</p>
          <p className="caption-5 text-muted">{yoctoToNear(e.paid)} NEAR went back to the requester.</p>
        </Card>
      ) : null}

      {r ? (
        <>
          <Card className="flex flex-col gap-6 p-6">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="flex flex-col gap-1">
                <span className="caption-4 text-muted">Score</span>
                <span className="tnum font-mono heading-1">{pct(r.score_bps)}</span>
                <span className="caption-2 text-muted">{r.correct} of {r.total} correct</span>
              </div>
              <div className="flex flex-col gap-2">
                <SignatureGrid total={r.total} signed={r.verified_responses} tone={r.mode === "Sealed" ? "sealed" : "leak"} />
                <span className="max-w-80 caption-5 text-muted">
                  One square per hidden question, lit when the answer carries the attested model's signature. Which ones were right stays sealed.
                </span>
              </div>
            </div>
            <dl className="grid gap-4 border-t border-line pt-6 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <dt className="caption-4 text-muted">Signed answers</dt>
                <dd className="tnum font-mono title-1">{r.verified_responses}/{r.total}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="caption-4 text-muted">Paid to the author</dt>
                <dd className="tnum font-mono title-1">{yoctoToNear(e.paid)} NEAR</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="caption-4 text-muted">Settled on chain</dt>
                <dd className="title-1">{ago(r.completed_ms)}</dd>
              </div>
            </dl>
          </Card>
          <Verify e={e} b={b} />
        </>
      ) : null}
    </section>
  );
}

function PendingCard({ e, accountId, onReclaimed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const canReclaim = accountId === e.requester && Date.now() > Number(e.created_ms) + TIMEOUT_MS;
  return (
    <Card className="flex flex-col gap-4 p-6">
      <span className="inline-flex items-center gap-2 title-3">
        <CircleNotch size={18} className="animate-spin text-sealed" aria-hidden />
        The TEE is attesting the model and running the hidden questions
      </span>
      <p className="body-6 text-muted">
        This page updates on its own. Most runs settle within a few minutes. If the agent doesn't answer within an hour,
        the requester can take the escrow back.
      </p>
      {canReclaim ? (
        <Button
          variant="secondary"
          className="w-fit"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await call("reclaim_eval", { eval_id: e.id });
              onReclaimed();
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          Reclaim {yoctoToNear(e.paid)} NEAR
        </Button>
      ) : null}
      <ErrorNote error={error} />
    </Card>
  );
}

function Check({ ok, label, detail }) {
  return (
    <li className="flex items-start gap-3 py-2">
      {ok === null ? (
        <CircleNotch size={18} className="mt-0.5 shrink-0 animate-spin text-muted" aria-hidden />
      ) : ok ? (
        <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-sealed" aria-hidden />
      ) : (
        <XCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-bad" aria-hidden />
      )}
      <span className="flex flex-col gap-1">
        <span className="body-5">{label}</span>
        {detail ? <span className="caption-5 text-muted break-all">{detail}</span> : null}
      </span>
    </li>
  );
}

/** Re-checks the run in the browser: evidence hash, attestation hash, and every signature. */
function Verify({ e, b }) {
  const r = e.result;
  const [s, setS] = useState({ loading: true });
  // Demo control: corrupt one character of the evidence locally to watch the checks catch it
  const [tampered, setTampered] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ text: fetchedEv }, { text: atText }] = await Promise.all([
          apiGetRaw(`/evals/${e.id}/evidence`),
          apiGetRaw(`/evals/${e.id}/attestation`),
        ]);
        const evText = tampered ? flipOneChar(fetchedEv) : fetchedEv;
        const evHash = await sha256HexOf(evText);
        const atHash = await sha256HexOf(atText);
        const evidence = JSON.parse(evText);
        const report = JSON.parse(atText);
        const modelAddrs = (report.model_attestations ?? []).map((a) => a.signing_address?.toLowerCase()).filter(Boolean);
        const gatewayAddr = report.gateway_attestation?.signing_address?.toLowerCase();

        let checked = 0;
        let valid = 0;
        for (const item of evidence.items ?? []) {
          if (!item.signature || !item.request_sha256 || !item.response_sha256) continue;
          checked++;
          // only the model TEE's own signature proves where the question went
          if (item.signature_kind !== "provider_tee") continue;
          const text =
            item.signature_kind === "provider_tee"
              ? `${evidence.model}:${item.request_sha256}:${item.response_sha256}`
              : `${item.request_sha256}:${item.response_sha256}`;
          try {
            const signer = verifyMessage(text, item.signature).toLowerCase();
            const allowed = item.signature_kind === "provider_tee" ? modelAddrs : [gatewayAddr];
            if (allowed.includes(signer)) valid++;
          } catch {
            // counts as invalid
          }
        }
        if (alive) {
          setS({
            loading: false,
            evHashOk: evHash === r.evidence_hash,
            atHashOk: atHash === r.model_attestation_hash,
            setOk: evidence.set_hash === b.set_hash,
            scoreOk:
              evidence.score?.correct === r.correct && evidence.score?.total === r.total && evidence.model === e.model && evidence.mode === r.mode,
            checked,
            valid,
            evidence,
            evText,
            atText,
          });
        }
      } catch (err) {
        if (alive) setS({ loading: false, error: err });
      }
    })();
    return () => {
      alive = false;
    };
  }, [e.id, r.evidence_hash, r.model_attestation_hash, b.set_hash, e.model, r.correct, r.total, r.mode, tampered]);

  const ev = s.evidence;
  const nv = ev?.model_attestation?.nvidia;
  const download = (text, name) => {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-[560px] flex-col gap-1">
          <h2 className="heading-6">Checked in your browser</h2>
          <p className="body-6 text-muted">
            Your browser fetched the evidence, hashed it against the chain and checked every answer signature itself.
            The NVIDIA line relies on tokens the agent saved, so download the evidence to verify them against NVIDIA's keys.
            The evidence holds hashes and signatures only, never questions or answers.
          </p>
        </div>
        {ev ? (
          <Button variant={tampered ? "primary" : "secondary"} size="sm" className="shrink-0 self-start" onClick={() => setTampered((t) => !t)}>
            {tampered ? <ArrowCounterClockwise size={14} weight="bold" aria-hidden /> : null}
            {tampered ? "Restore the real evidence" : "Tamper test: flip one character"}
          </Button>
        ) : null}
      </div>
      {tampered ? (
        <p role="status" className="rounded-lg border border-bad/30 bg-bad-bg px-3 py-2 body-6 text-bad">
          One character of the evidence was changed in your browser. The checks below now fail, as they would for a forged result.
        </p>
      ) : null}
      {s.error ? <ErrorNote error={s.error} /> : null}
      <ul className="flex flex-col divide-y divide-line">
        <Check ok={s.loading ? null : s.evHashOk} label="Evidence file matches the hash settled on chain" detail={r.evidence_hash} />
        <Check ok={s.loading ? null : s.atHashOk} label="Attestation report matches the hash settled on chain" detail={r.model_attestation_hash} />
        <Check ok={s.loading ? null : s.setOk} label="Evidence names the benchmark hash the author sealed" detail={b.set_hash} />
        <Check ok={s.loading ? null : s.scoreOk} label="Model, mode and score in the evidence are consistent with the chain" />
        {r.mode === "Sealed" ? (
          <>
            <Check
              ok={s.loading ? null : !!nv?.overall && !!nv?.nonceMatch && !!ev?.model_attestation?.nras_response}
              label="Agent reports NVIDIA passed the GPU attestation for this run's nonce, raw NVIDIA tokens included"
              detail={nv ? `${nv.gpus?.map((g) => g.hwmodel).filter(Boolean).join(", ") || "GPU"} · nonce ${short(ev.model_attestation.nonce, 10, 6)}` : null}
            />
            <Check
              ok={s.loading ? null : s.valid === r.total && r.verified_responses === r.total}
              label={s.loading ? "Checking answer signatures" : `${s.valid} of ${r.total} answers are signed by the attested model TEE`}
              detail={ev ? `Model TEE keys: ${ev.model_attestation.model_signing_addresses.map((a) => short(a, 8, 6)).join(", ")}` : null}
            />
          </>
        ) : (
          <Check
            ok={false}
            label="Not sealed: the model was not proven to run in an attested TEE"
            detail={ev?.model_attestation?.not_sealed_reason ?? "The provider could read the questions. The author allowed this run."}
          />
        )}
      </ul>
      {ev ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button variant="secondary" size="sm" onClick={() => download(s.evText, `sealed-eval-${e.id}-evidence.json`)}>
            <DownloadSimple size={14} aria-hidden /> Evidence
          </Button>
          <Button variant="secondary" size="sm" onClick={() => download(s.atText, `sealed-eval-${e.id}-attestation.json`)}>
            <DownloadSimple size={14} aria-hidden /> Attestation report
          </Button>
          <AgentLink account={r.agent} />
        </div>
      ) : null}
    </Card>
  );
}

function AgentLink({ account }) {
  const cfg = useAsync(getConfig, []);
  if (!cfg.data) return null;
  return (
    <a
      href={explorerAccount(cfg.data.network, account)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-lg px-3 py-2 button-sm text-muted transition duration-300 ease-weighted hover:bg-hover hover:text-ink"
    >
      Agent <Mono>{short(account, 8, 6)}</Mono> <ArrowSquareOut size={14} aria-hidden />
    </a>
  );
}

/** Changes one hex character of the first answer hash, as an attacker editing the evidence would. */
function flipOneChar(text) {
  const m = text.match(/"response_sha256": "([0-9a-f])/);
  if (!m) return text + " ";
  const at = m.index + m[0].length - 1;
  const flipped = m[1] === "0" ? "1" : "0";
  return text.slice(0, at) + flipped + text.slice(at + 1);
}
