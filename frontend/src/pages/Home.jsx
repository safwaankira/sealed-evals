import { useEffect, useRef } from "react";
import { ArrowRight, LockKey, CheckCircle } from "@phosphor-icons/react";
import { useAsync } from "../lib/hooks";
import { loadBoard } from "../lib/data";
import { yoctoToNear, pct, ago, short } from "../lib/format";
import { LinkButton, ModeBadge, Reveal, Skeleton, Mono, ErrorNote, SignatureGrid } from "../components/ui";
import Leaderboard from "../components/Leaderboard";

export default function Home() {
  const board = useAsync(loadBoard, [], { pollMs: 15000 });
  const stats = board.data?.stats;
  const done = (board.data?.rows ?? []).flatMap((r) =>
    r.evals.filter((e) => e.status === "Completed" && e.result).map((e) => ({ e, b: r.benchmark })),
  );
  const latest = [...done].sort((x, y) => Number(y.e.result.completed_ms) - Number(x.e.result.completed_ms))[0];
  const signed = done.reduce((s, { e }) => s + (e.result.verified_responses ?? 0), 0);
  const loading = board.loading && !board.data;

  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-12 mt-12 px-4 pb-16 pt-24 md:mt-16 lg:grid-cols-[1fr_400px] lg:items-center">
        <div className="flex flex-col gap-6">
          <span className="inline-flex items-center gap-2 caption-4 text-muted">
            <span className="h-2 w-2 rounded-sm bg-sealed" aria-hidden />
            Private AI on NEAR · runs in a Shade Agent TEE
          </span>
          <h1 className="hero-gradient heading-3 max-w-[680px] sm:heading-2 md:heading-1">
            AI scores you can trust,
            <br className="hidden sm:block" />{" "}
            because nobody saw the test
          </h1>
          <p className="max-w-[680px] body-3 text-muted md:title-2 md:text-muted">
            Benchmark questions stay sealed inside attested hardware. Models are graded there, only the score and its
            proof come out, and the author earns NEAR on every run.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <LinkButton href="#/run">
              Run a sealed eval
              <ArrowRight size={16} weight="bold" aria-hidden />
            </LinkButton>
            <a href="#/trust" className="body-5 text-muted underline decoration-line underline-offset-4 transition duration-300 ease-weighted hover:text-ink">
              See how it is proven
            </a>
          </div>
        </div>
        <ExamSheet latest={latest} loading={loading} />
      </section>

      {/* Live numbers, straight from the contract */}
      <section className="mx-auto max-w-6xl px-4 pb-16" aria-label="Live on NEAR testnet">
        <dl className="grid grid-cols-2 gap-8 border-y border-line py-8 md:grid-cols-4">
          <Stat label="Sealed benchmarks" value={stats?.benchmarks} />
          <Stat label="Scored runs" value={stats?.runs} />
          <Stat label="Answers signed by a model TEE" value={stats ? signed : undefined} />
          <Stat label="NEAR paid to authors" value={stats ? yoctoToNear(stats.paid, 2) : undefined} />
        </dl>
        <p className="mt-3 caption-5 text-faint">Read live from the NEAR testnet contract.</p>
      </section>

      {/* Leaderboard */}
      <Reveal className="mx-auto max-w-6xl px-4 py-16" id="leaderboard">
        <div className="mb-8 flex flex-col gap-2">
          <h2 className="heading-4 md:heading-3">Leaderboard</h2>
          <p className="max-w-[680px] body-6 text-muted">
            Graded inside the TEE, settled on chain. Sealed runs rank above leak risk runs, whatever the score.
          </p>
        </div>
        <ErrorNote error={board.error} className="mb-4" />
        <Leaderboard rows={board.data?.rows} loading={loading} compact />
      </Reveal>

      <TaglineReveal text="A benchmark is only useful until its questions leak. Seal it once, and every score it gives stays honest." />

      <HowItWorks latest={latest} />

      <Labels />

      <Faq />

      {/* Final CTA */}
      <Reveal className="mx-auto max-w-6xl px-4 py-24">
        <div className="flex flex-col items-start gap-8 border-t border-line pt-16 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-[680px] flex-col gap-3">
            <h2 className="heading-4 md:heading-3">Score a model on a test it has never seen</h2>
            <p className="body-3 text-muted">Pick a sealed benchmark and a model, then pay per run. A run that can't be proven is refunded in full.</p>
          </div>
          <LinkButton href="#/run">
            Run a sealed eval
            <ArrowRight size={16} weight="bold" aria-hidden />
          </LinkButton>
        </div>
      </Reveal>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="order-2 caption-2 text-muted">{label}</dt>
      <dd className="order-1 tnum font-mono heading-4 md:heading-3">
        {value === undefined ? <Skeleton className="h-9 w-16" /> : value}
      </dd>
    </div>
  );
}

// widths for the redacted question lines, so the sheet looks like a real test paper
const LINES = [92, 74, 86, 58, 80, 67];

/** The hero visual: the test nobody can read, and the score that came out of it. */
function ExamSheet({ latest, loading }) {
  if (loading) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
        <Skeleton className="h-5 w-48" />
        {LINES.map((w, i) => (
          <Skeleton key={i} className="h-3" />
        ))}
        <Skeleton className="h-16 w-40" />
      </div>
    );
  }
  const e = latest?.e;
  const r = e?.result;
  const b = latest?.b;
  const total = r?.total ?? b?.item_count ?? 39;
  return (
    <a
      href={e ? `#/eval/${e.id}` : "#/run"}
      className="group flex flex-col rounded-2xl border border-line bg-surface p-2 transition duration-500 ease-weighted hover:-translate-y-1"
    >
      {/* the questions: present, counted, unreadable */}
      <div className="flex flex-col gap-4 rounded-lg bg-void p-6">
        <div className="flex items-center justify-between gap-4">
          <span className="truncate title-4">{b?.name ?? "A sealed benchmark"}</span>
          <span className="inline-flex shrink-0 items-center gap-1 caption-4 text-muted">
            <LockKey size={14} className="text-sealed" aria-hidden />
            {total} questions
          </span>
        </div>
        <ol className="flex flex-col gap-3" aria-label="Hidden questions">
          {LINES.map((w, i) => (
            <li key={i} className="grid grid-cols-[24px_1fr_16px] items-center gap-3">
              <span className="tnum font-mono caption-5 text-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className="redact" style={{ width: `${w}%` }} aria-hidden />
              {r ? <CheckCircle size={16} weight="fill" className="text-sealed" aria-label="answer signed" /> : <span />}
            </li>
          ))}
        </ol>
        <span className="caption-5 text-faint">and {total - LINES.length} more, readable only inside the TEE</span>
      </div>

      {/* what came out */}
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="caption-4 text-muted">{r ? `Latest result · ${ago(r.completed_ms)}` : "Example result"}</span>
            <span className="truncate title-3">{e?.model ?? "An open model in a NEAR AI TEE"}</span>
          </div>
          <ModeBadge mode={r?.mode ?? "Sealed"} />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-end gap-2">
            <span className="tnum font-mono heading-2">{r ? pct(r.score_bps) : "94.9%"}</span>
            <span className="pb-1 caption-2 text-muted">{r ? `${r.correct} of ${r.total}` : "37 of 39"}</span>
          </div>
          <SignatureGrid total={total} signed={r ? r.verified_responses : total} />
        </div>
        <span className="flex items-center justify-between gap-2 caption-5 text-muted">
          <span>Evidence hash on chain</span>
          <Mono className="text-ink">{r ? short(r.evidence_hash, 10, 8) : "settles after the first run"}</Mono>
        </span>
      </div>
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
      <p ref={ref} className="max-w-[680px] heading-4 md:heading-2">
        {words.map((w, i) => (
          <span key={i} className="word">
            {w}{" "}
          </span>
        ))}
      </p>
    </section>
  );
}

function HowItWorks({ latest }) {
  const r = latest?.e?.result;
  const steps = [
    {
      n: "01",
      title: "Seal",
      body: "The author encrypts the test set in their browser to a key that only exists inside the TEE. The chain keeps its hash and a price per run.",
      proof: ["Sealed file hash", latest?.b?.set_hash],
    },
    {
      n: "02",
      title: "Run",
      body: "Anyone pays the price. Before a single question leaves, the TEE asks the model for a fresh attestation and checks the GPU report with NVIDIA.",
      proof: ["Model TEE attested", r ? `${r.verified_responses} of ${r.total} answers signed by its key` : null],
    },
    {
      n: "03",
      title: "Prove",
      body: "The TEE grades every answer, settles the score and the evidence hash on NEAR, and the contract pays the author. Any browser can recheck it.",
      proof: ["Evidence hash on chain", r?.evidence_hash],
    },
  ];
  return (
    <Reveal className="mx-auto grid max-w-6xl gap-12 px-4 py-16 lg:grid-cols-[1fr_1.4fr]">
      <div className="flex flex-col gap-3 lg:sticky lg:top-24 lg:self-start">
        <h2 className="heading-4 md:heading-3">From sealed file to paid score</h2>
        <p className="body-6 text-muted">
          Three steps, each leaving something you can check yourself. The values on the right are from the latest real run.
        </p>
      </div>
      <ol className="relative flex flex-col gap-12">
        <span className="absolute bottom-4 left-4 top-4 w-px bg-line" aria-hidden />
        {steps.map((s) => (
          <li key={s.n} className="relative grid grid-cols-[32px_1fr] gap-6">
            <span className="relative z-10 grid h-8 w-8 place-items-center rounded-lg border border-line bg-void font-mono caption-3 text-sealed">
              {s.n}
            </span>
            <div className="flex flex-col gap-3">
              <h3 className="heading-6">{s.title}</h3>
              <p className="body-6 text-muted">{s.body}</p>
              {s.proof[1] ? (
                <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3">
                  <span className="caption-5 text-muted">{s.proof[0]}</span>
                  <Mono className="caption-5 text-ink">{s.proof[1]}</Mono>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Reveal>
  );
}

const LABEL_ROWS = [
  ["Which models", "Open models served from NEAR AI Cloud TEEs", "Closed API models, or any model whose attestation fails"],
  ["Who sees the questions", "Attested enclaves only", "The model provider, so the set is partly burned"],
  ["Proof per answer", "Signed by a key from a fresh, NVIDIA checked attestation", "None"],
  ["When it runs", "Always, if every answer verifies. One bad signature stops the run and refunds it", "Only if the author allowed it when sealing. Otherwise refused before anything is sent"],
];

function Labels() {
  return (
    <Reveal className="mx-auto max-w-6xl px-4 py-16">
      <h2 className="mb-3 heading-4 md:heading-3">Two labels, no fine print</h2>
      <p className="mb-8 max-w-[680px] body-6 text-muted">
        A score is only marked Sealed when the agent can prove where the questions went. Everything else says so, and authors
        decide whether those runs happen at all.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="w-1/4 px-6 py-4" scope="col"><span className="sr-only">Property</span></th>
              <th className="px-6 py-4" scope="col"><ModeBadge mode="Sealed" /></th>
              <th className="px-6 py-4" scope="col"><ModeBadge mode="LeakRisk" /></th>
            </tr>
          </thead>
          <tbody>
            {LABEL_ROWS.map(([k, a, b]) => (
              <tr key={k} className="border-b border-line last:border-0">
                <th scope="row" className="px-6 py-4 align-top title-4 text-muted">{k}</th>
                <td className="px-6 py-4 align-top body-6 text-ink">{a}</td>
                <td className="px-6 py-4 align-top body-6 text-muted">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Reveal>
  );
}

const FAQ = [
  ["Can anyone see my questions?", "Not the operator, not the chain, not other users. You encrypt the file in your browser to a key derived inside the TEE. The agent only accepts it if it decrypts there and matches the hash you registered. Questions then go only to models whose TEE attestation passes."],
  ["What does Leak risk mean?", "The model is a closed API or its attestation failed, so the provider could read the questions. Those runs are labeled, and they only happen if the author allowed them when sealing. Otherwise the run is refused before anything is sent."],
  ["Which models can be Sealed?", "Open models that NEAR AI Cloud serves from TEE nodes. The agent asks for a fresh attestation with its own nonce, checks the GPU report with NVIDIA, and requires every answer to be signed by a key from that report."],
  ["How do I check a score myself?", "Open any result. Your browser downloads the evidence file, hashes it and compares it with the hash on chain, then checks each answer's signature against the attested key. No questions are in the evidence, only hashes and signatures."],
  ["Who gets paid?", "The benchmark author, automatically, when a score settles. The author sets the price per run and the contract holds it in escrow until then."],
  ["What if a run fails?", "The agent refunds the full price on chain. If the agent never answers, you can reclaim your escrow yourself after one hour."],
  ["What can't this protect against?", "You still trust Intel TDX and NVIDIA confidential computing, and the agent's code, which is open source and pinned by its measurements on chain. The trust page lists the remaining gaps plainly."],
  ["Is this live on mainnet?", "Not yet. The hackathon build runs on NEAR testnet so you can try it without spending real money."],
];

function Faq() {
  return (
    <Reveal className="mx-auto grid max-w-6xl gap-12 px-4 py-16 lg:grid-cols-[1fr_1.4fr]" id="faq">
      <div className="flex flex-col gap-3 lg:sticky lg:top-24 lg:self-start">
        <h2 className="heading-4 md:heading-3">Questions</h2>
        <p className="body-6 text-muted">
          Something missing? The <a className="text-ink underline" href="#/trust">trust page</a> maps every claim to the code and tests behind it.
        </p>
      </div>
      <dl className="flex flex-col">
        {FAQ.map(([q, a]) => (
          <div key={q} className="flex flex-col gap-2 border-b border-line py-6 first:pt-0 last:border-0">
            <dt className="title-3">{q}</dt>
            <dd className="body-6 text-muted">{a}</dd>
          </div>
        ))}
      </dl>
    </Reveal>
  );
}
