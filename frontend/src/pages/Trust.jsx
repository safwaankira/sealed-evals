import { useEffect, useState } from "react";
import { Copy, ArrowSquareOut, ShieldCheck, Key, Cpu, Scales } from "@phosphor-icons/react";
import { sealKeyReportData } from "@shared/envelope";
import { useAsync } from "../lib/hooks";
import { apiGet } from "../lib/api";
import { view, getConfig, explorerAccount } from "../lib/near";
import { short } from "../lib/format";
import { Button, Card, ErrorNote, Mono, Skeleton } from "../components/ui";

export default function Trust() {
  const chain = useAsync(async () => {
    const cfg = await getConfig();
    const [info, agents] = await Promise.all([
      view("get_contract_info", {}),
      view("get_agents", { from_index: 0, limit: 20 }),
    ]);
    return { cfg, info, agents: agents ?? [] };
  }, []);
  const key = useAsync(() => apiGet("/seal-key"), []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("s");
    if (s) setTimeout(() => document.getElementById(s)?.scrollIntoView({ behavior: "smooth" }), 300);
  }, []);

  return (
    <section className="mx-auto mt-12 flex max-w-4xl flex-col gap-12 px-4 pt-24">
      <div className="flex flex-col gap-2">
        <h1 className="heading-4 md:heading-3">How trust works</h1>
        <p className="max-w-[680px] body-6 text-muted">
          Four links, each one checkable without asking us. If any link breaks, a run is refused or labeled Leak risk.
        </p>
      </div>

      <Step icon={ShieldCheck} n="1" title="The chain only accepts results from attested code">
        <p className="body-6 text-muted">
          The agent runs as a Shade Agent on Phala Cloud. To register, it sends the NEAR contract an Intel TDX
          attestation. The contract verifies it on chain and only accepts code whose measurements the owner approved.
          Only registered agents can seal benchmarks, settle scores or refund.
        </p>
        {chain.loading && !chain.data ? (
          <Skeleton className="h-24 w-full" />
        ) : chain.error ? (
          <ErrorNote error={chain.error} />
        ) : (
          <div className="flex flex-col gap-2 rounded-lg bg-void p-4 caption-2">
            <Row k="Contract">
              <a className="underline" target="_blank" rel="noreferrer" href={explorerAccount(chain.data.cfg.network, chain.data.cfg.contractId)}>
                {chain.data.cfg.contractId}
              </a>
            </Row>
            <Row k="Requires a TEE">
              <span className={chain.data.info.requires_tee ? "text-sealed" : "text-leak"}>
                {chain.data.info.requires_tee ? "Yes" : "No, local test mode"}
              </span>
            </Row>
            {chain.data.agents.map((a) => (
              <Row key={a.account_id} k="Registered agent">
                <span className="flex flex-col gap-1">
                  <Mono>{a.account_id}</Mono>
                  <span className={a.validity === "Valid" ? "text-sealed" : "text-bad"}>
                    {a.validity === "Valid" ? "Valid" : `Invalid: ${JSON.stringify(a.validity.Invalid)}`} · compose hash{" "}
                    <Mono className="text-ink">{short(a.measurements.app_compose_hash_payload, 10, 8)}</Mono>
                  </span>
                </span>
              </Row>
            ))}
          </div>
        )}
      </Step>

      <Step icon={Key} n="2" title="Your file can only be opened inside that code">
        <p className="body-6 text-muted">
          The seal key is derived inside the TEE by Phala's key management, so it never exists outside it. The agent
          publishes it on chain, which only attested code can do, and the seal page encrypts to that on chain copy. The
          agent also proves the key with a TDX quote whose report data commits to it. Ask for a fresh quote with your
          own random nonce, then paste it into Phala's verifier.
        </p>
        <SealKeyProof keyData={key} />
      </Step>

      <Step icon={Cpu} n="3" title="Questions only go to models that prove they run in a TEE">
        <p className="body-6 text-muted">
          For every run, the agent asks NEAR AI Cloud for an attestation report with a fresh nonce, sends the GPU
          evidence to NVIDIA's attestation service and requires a pass bound to that nonce. Each answer must then be
          signed by a key listed in that report. If any of that fails, the run is either refused and refunded, or, only
          when the author allowed it, recorded as Leak risk.
        </p>
      </Step>

      <Step icon={Scales} n="4" title="The score and its evidence are settled together">
        <p className="body-6 text-muted">
          Grading happens inside the TEE. The agent publishes an evidence file of hashes and signatures, and the
          contract stores its hash next to the score and pays the author. Any result page re-checks all of this in your
          browser.
        </p>
      </Step>

      <div id="privacy" className="flex scroll-mt-24 flex-col gap-4">
        <h2 className="heading-5">Privacy</h2>
        <ul className="flex list-disc flex-col gap-2 pl-4 body-6 text-muted">
          <li>Benchmark files are encrypted in your browser and only decrypted inside the TEE, where they are re-encrypted before touching disk.</li>
          <li>The chain stores names, prices, hashes, scores and account ids. Never questions or answers.</li>
          <li>Evidence files contain hashes of requests and responses, signatures and attestation data. Never prompt or answer text.</li>
          <li>This site uses no cookies, analytics or trackers. Your wallet connection is stored in your own browser.</li>
        </ul>
      </div>

      <div id="limits" className="flex scroll-mt-24 flex-col gap-4">
        <h2 className="heading-5">What this does not protect against</h2>
        <ul className="flex list-disc flex-col gap-2 pl-4 body-6 text-muted">
          <li>Hardware trust. You rely on Intel TDX, NVIDIA confidential computing and Phala's key management. A break in those breaks the seal.</li>
          <li>The contract owner approves which code may register. Approving malicious code could expose sealed sets, so the code is open source and its measurements are public on chain.</li>
          <li>The agent verifies the GPU attestation and every answer signature, but does not yet independently verify the TDX quotes of NEAR AI's gateway and model nodes. It records their hash so anyone can check them.</li>
          <li>The seal key comes from Phala's key management for this app. Whoever controls the Phala app could deploy a build that derives the same key, so the app id and its compose hash are part of what you trust.</li>
          <li>Evidence includes a hash of each request, which NEAR AI's signature covers. Someone who can guess a question word for word, with the same formatting, could confirm it was in the set.</li>
          <li>If a payout or refund goes to an account that no longer exists, the NEAR stays in the contract.</li>
          <li>Leak risk runs really do show the questions to the provider. That is why authors must opt in.</li>
          <li>Graders compare answers by exact text, contained text, number or multiple choice. Open ended tasks are out of scope for now.</li>
          <li>This is a hackathon build on NEAR testnet.</li>
        </ul>
      </div>
    </section>
  );
}

function Step({ icon: Icon, n, title, children }) {
  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-sealed-bg text-sealed">
          <Icon size={20} aria-hidden />
        </span>
        <h2 className="heading-6">
          <span className="text-muted">{n}.</span> {title}
        </h2>
      </div>
      {children}
    </Card>
  );
}

function Row({ k, children }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[160px_1fr] sm:gap-4">
      <span className="text-muted">{k}</span>
      <span className="min-w-0 break-all text-ink">{children}</span>
    </div>
  );
}

function SealKeyProof({ keyData }) {
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  if (keyData.loading && !keyData.data) return <Skeleton className="h-24 w-full" />;
  if (keyData.error) return <ErrorNote error={keyData.error} />;
  const k = fresh ?? keyData.data;
  const tee = k.tee_mode === "tee";
  const bindingOk = keyData.data.report_data === sealKeyReportData(keyData.data.public_key);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg bg-void p-4 caption-2">
        <Row k="Mode">
          <span className={tee ? "text-sealed" : "text-leak"}>{tee ? "Inside a TEE" : "Local test agent, not in a TEE"}</span>
        </Row>
        <Row k="Seal public key"><Mono>{k.public_key}</Mono></Row>
        <Row k="Report data"><Mono>{k.report_data}</Mono></Row>
        <Row k="Commits to the key">
          <span className={bindingOk ? "text-sealed" : "text-bad"}>
            {bindingOk ? "Report data matches the key. Verify the quote itself on Phala's explorer." : "No"}
          </span>
        </Row>
        {k.nonce ? <Row k="Your nonce"><Mono>{k.nonce}</Mono></Row> : null}
        {k.compose_hash ? <Row k="Compose hash"><Mono>{k.compose_hash}</Mono></Row> : null}
        {k.quote ? <Row k="Quote"><Mono>{short(k.quote, 48, 24)}</Mono></Row> : null}
      </div>
      <ErrorNote error={error} />
      {tee ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const nonce = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
                setFresh(await apiGet(`/seal-key?nonce=${nonce}`));
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Get a fresh quote with my nonce
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(k.quote);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            <Copy size={14} aria-hidden /> {copied ? "Quote copied" : "Copy quote"}
          </Button>
          <a
            href="https://proof.t16z.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 button-sm text-muted transition duration-300 ease-weighted hover:bg-hover hover:text-ink"
          >
            Verify on Phala's explorer <ArrowSquareOut size={14} aria-hidden />
          </a>
        </div>
      ) : null}
      {k.nonce ? (
        <p className="caption-5 text-muted">
          With a nonce, report data is sha256 of the key commitment, a colon and your nonce, so the quote cannot be a replay.
        </p>
      ) : null}
    </div>
  );
}
