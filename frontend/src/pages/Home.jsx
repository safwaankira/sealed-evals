import { useEffect, useRef, useState } from "react";
import { ArrowRight, LockKey, Warning, FileLock, Cpu, SealCheck, CaretDown } from "@phosphor-icons/react";
import { useAsync } from "../lib/hooks";
import { loadBoard } from "../lib/data";
import { yoctoToNear, pct, ago } from "../lib/format";
import { Card, LinkButton, ModeBadge, Reveal, Skeleton, Mono, ErrorNote } from "../components/ui";
import Leaderboard from "../components/Leaderboard";

export default function Home() {
  const board = useAsync(loadBoard, [], { pollMs: 15000 });
  const stats = board.data?.stats;
  const latest = board.data?.rows
    .flatMap((r) => r.evals.filter((e) => e.status === "Completed").map((e) => ({ e, b: r.benchmark })))
    .sort((x, y) => Number(y.e.result.completed_ms) - Number(x.e.result.completed_ms))[0];

  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-12 mt-12 px-4 pb-16 pt-24 lg:grid-cols-[1fr_400px] lg:items-center">
        <div className="flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 caption-4 text-muted">
            <LockKey size={14} className="text-sealed" aria-hidden />
            Private AI on NEAR, running in a Shade Agent TEE
          </span>
          <h1 className="hero-gradient heading-2 max-w-[680px] md:heading-1">
            AI scores you can trust,
            <br />
            because nobody saw the test
          </h1>
          <p className="max-w-[680px] body-3 text-muted md:title-2 md:text-muted">
            Sealed Evals keeps benchmark questions inside attested hardware. Models are scored in a TEE, only the score
            and its proof come out, and the benchmark author earns NEAR on every run.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <LinkButton href="#/run">
              Run a sealed eval
              <ArrowRight size={16} weight="bold" aria-hidden />
            </LinkButton>
          </div>
          <p className="caption-2 text-muted">
            {stats ? (
              <>
                Live on NEAR testnet: <span className="text-ink">{stats.benchmarks}</span> sealed benchmarks ·{" "}
                <span className="text-ink">{stats.runs}</span> scored runs ·{" "}
                <span className="text-ink">{yoctoToNear(stats.paid, 2)} NEAR</span> paid to authors
              </>
            ) : (
              <span className="inline-block h-5 w-64 skeleton align-middle" />
            )}
          </p>
        </div>
        <HeroCard latest={latest} loading={board.loading && !board.data} />
      </section>

      {/* Leaderboard */}
      <Reveal className="mx-auto max-w-6xl px-4 py-16" id="leaderboard">
        <div className="mb-8 flex flex-col gap-2">
          <h2 className="heading-4 md:heading-3">Leaderboard</h2>
          <p className="body-6 text-muted">
            Every score below was graded inside the TEE and settled on chain. Sealed runs rank first.
          </p>
        </div>
        <ErrorNote error={board.error} className="mb-4" />
        <Leaderboard rows={board.data?.rows} loading={board.loading && !board.data} compact />
      </Reveal>

      <TaglineReveal
        text="A benchmark is only useful until its questions leak. Seal it once, and every score it gives stays honest."
      />

      {/* How it works */}
      <Reveal className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="mb-8 heading-4 md:heading-3">How it works</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            [FileLock, "1. Seal", "The author encrypts the test set in their browser to a key that only exists inside the TEE. The chain stores its hash and price."],
            [Cpu, "2. Run", "Anyone pays per run. Before a single question leaves, the TEE checks the model is served from attested NVIDIA hardware."],
            [SealCheck, "3. Prove", "The TEE grades every answer, publishes evidence with the model's signatures, settles the score on NEAR and pays the author."],
          ].map(([Icon, title, body]) => (
            <Card key={title} className="flex flex-col gap-4 p-6">
              <Icon size={28} className="text-sealed" aria-hidden />
              <h3 className="heading-6">{title}</h3>
              <p className="body-6 text-muted">{body}</p>
            </Card>
          ))}
        </div>
      </Reveal>

      {/* Sealed vs leak risk */}
      <Reveal className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="mb-2 heading-4 md:heading-3">Two labels, no fine print</h2>
        <p className="mb-8 max-w-[680px] body-6 text-muted">
          A score is only marked Sealed when the agent can prove where the questions went. Everything else is labeled, and
          authors decide whether those runs are allowed at all.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col gap-4 p-6">
            <span className="w-fit"><ModeBadge mode="Sealed" /></span>
            <p className="body-5">Open models served from NEAR AI Cloud TEEs.</p>
            <ul className="flex list-disc flex-col gap-2 pl-4 body-6 text-muted">
              <li>Fresh attestation for every run, checked against NVIDIA with our own nonce</li>
              <li>Every answer signed by a key from that attestation</li>
              <li>Questions only ever exist inside attested enclaves</li>
            </ul>
          </Card>
          <Card className="flex flex-col gap-4 p-6">
            <span className="w-fit"><ModeBadge mode="LeakRisk" /></span>
            <p className="body-5">Closed API models, or any model whose attestation fails.</p>
            <ul className="flex list-disc flex-col gap-2 pl-4 body-6 text-muted">
              <li>The provider saw the questions, so the set is partly burned</li>
              <li>Only runs if the author opted in when sealing</li>
              <li>Otherwise refused before any question is sent, and refunded</li>
            </ul>
          </Card>
        </div>
      </Reveal>

      <Faq />

      {/* Final CTA */}
      <Reveal className="mx-auto max-w-6xl px-4 py-16">
        <Card className="flex flex-col items-start gap-6 p-8 md:flex-row md:items-center md:justify-between md:p-12">
          <div className="flex flex-col gap-2">
            <h2 className="heading-5 md:heading-4">Score a model on a test it has never seen</h2>
            <p className="body-6 text-muted">Pick a sealed benchmark, pick a model, pay per run. Failed runs are refunded.</p>
          </div>
          <LinkButton href="#/run">
            Run a sealed eval
            <ArrowRight size={16} weight="bold" aria-hidden />
          </LinkButton>
        </Card>
      </Reveal>
    </>
  );
}

function HeroCard({ latest, loading }) {
  if (loading) {
    return (
      <Card className="flex flex-col gap-4 p-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-16 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </Card>
    );
  }
  const example = !latest;
  const e = latest?.e;
  const r = e?.result;
  return (
    <a href={example ? "#/run" : `#/eval/${e.id}`} className="block transition duration-500 ease-weighted hover:-translate-y-1">
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <span className="caption-4 uppercase tracking-wide text-muted">{example ? "Example result" : "Latest result"}</span>
          <ModeBadge mode={r?.mode ?? "Sealed"} />
        </div>
        <div className="flex items-end gap-2">
          <span className="font-mono heading-2">{r ? pct(r.score_bps) : "73.5%"}</span>
          <span className="pb-1 caption-2 text-muted">{r ? `${r.correct} of ${r.total}` : "36 of 49"}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="title-4">{e?.model ?? "an open model in a NEAR AI TEE"}</span>
          <span className="caption-5 text-muted">
            on {latest?.b.name ?? "a sealed benchmark"} {r ? `· ${ago(r.completed_ms)}` : ""}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg bg-void p-3">
          <span className="caption-5 text-muted">Evidence hash on chain</span>
          <Mono className="caption-5 text-ink">{r?.evidence_hash ?? "settles here after the first run"}</Mono>
        </div>
        <span className="caption-5 text-muted">
          {r ? `${r.verified_responses} of ${r.total} answers carry a verified TEE signature` : "No runs yet. Be the first."}
        </span>
      </Card>
    </a>
  );
}

function TaglineReveal({ text }) {
  const ref = useRef(null);
  const words = text.split(" ");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const spans = [...el.querySelectorAll(".word")];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      spans.forEach((s) => s.classList.add("on"));
      return;
    }
    // each word lights up as it crosses a line 60% down the viewport
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => en.isIntersecting && en.target.classList.add("on")),
      { rootMargin: "0px 0px -40% 0px", threshold: 1 },
    );
    spans.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <p ref={ref} className="max-w-[680px] heading-4 md:heading-3">
        {words.map((w, i) => (
          <span key={i} className="word">
            {w}{" "}
          </span>
        ))}
      </p>
    </section>
  );
}

const FAQ = [
  ["Can anyone see my questions?", "Not the operator, not the chain, not other users. You encrypt the file in your browser to a key derived inside the TEE. The agent only accepts it if it decrypts there and matches the hash you registered. Questions then go only to models whose TEE attestation passes."],
  ["What does Leak risk mean?", "The model is a closed API or its attestation failed, so the provider could read the questions. Those runs are labeled, and they only happen if the author allowed them when sealing. Otherwise the run is refused before anything is sent."],
  ["Which models can be Sealed?", "Open models that NEAR AI Cloud serves from TEE nodes. The agent asks for a fresh attestation with its own nonce, checks the GPU report with NVIDIA, and requires every answer to be signed by a key from that report."],
  ["How do I check a score myself?", "Open any result. Your browser downloads the evidence file, hashes it and compares it with the hash on chain, then checks each answer's signature against the attested key. No questions are in the evidence, only hashes and signatures."],
  ["Who gets paid?", "The benchmark author, automatically, when a score settles. The price is set by the author per run and held in escrow by the contract until then."],
  ["What if a run fails?", "The agent refunds the full price on chain. If the agent never answers, you can reclaim your escrow yourself after one hour."],
  ["What can't this protect against?", "You still trust Intel TDX and NVIDIA confidential computing, and the agent's code, which is open source and pinned by its measurements on chain. The trust page lists the remaining gaps plainly."],
  ["Is this live on mainnet?", "Not yet. The hackathon build runs on NEAR testnet so you can try it without spending real money."],
];

function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <Reveal className="mx-auto max-w-6xl px-4 py-16" id="faq">
      <h2 className="mb-8 heading-4 md:heading-3">Questions</h2>
      <div className="flex flex-col gap-2">
        {FAQ.map(([q, a], i) => (
          <div key={q} className="rounded-xl border border-line bg-surface">
            <button
              className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left title-3 transition duration-300 ease-weighted hover:bg-raised rounded-xl"
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? -1 : i)}
            >
              {q}
              <CaretDown size={16} className={`shrink-0 text-muted transition duration-500 ease-weighted ${open === i ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {open === i ? <p className="px-4 pb-4 body-6 text-muted">{a}</p> : null}
          </div>
        ))}
      </div>
    </Reveal>
  );
}
