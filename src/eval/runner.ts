// Runs one paid eval: attest the model, run every hidden item, grade inside the TEE,
// publish evidence (hashes and signatures only) and settle on chain.

import { agent } from "../near/agent";
import { config, VERSION } from "../config";
import { DEFAULT_SYSTEM, grade, parseBenchmark } from "../shared/benchmark";
import { sha256Hex } from "../shared/envelope";
import { attestModel, chat, checkSignature, type ModelAttestation } from "../nearai/client";
import { loadEvidence, loadSealedBenchmark, saveEvidence } from "../tee/store";
import { keys } from "../tee/keys";
import type { BenchmarkView, EvalView } from "../near/types";

// Per-item correctness is deliberately NOT published: index + correct would leak one bit per hidden answer.
export interface ItemRecord {
  index: number;
  error: string | null;
  request_sha256: string | null;
  response_sha256: string | null;
  signature_kind: string | null;
  signing_address: string | null;
  signature: string | null;
  signature_verified: boolean;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
  shouldStop: () => boolean = () => false,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !shouldStop()) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

async function failEval(evalId: string, reason: string): Promise<void> {
  console.log(`eval ${evalId}: failing (${reason})`);
  await agent().call({ methodName: "fail_eval", args: { eval_id: evalId, reason } });
}

async function submit(evalId: string, evidenceJson: string): Promise<void> {
  const e = JSON.parse(evidenceJson);
  await agent().call({
    methodName: "submit_result",
    args: {
      eval_id: evalId,
      mode: e.mode,
      correct: e.score.correct,
      total: e.score.total,
      verified_responses: e.score.verified_responses,
      evidence_hash: sha256Hex(evidenceJson),
      model_attestation_hash: e.model_attestation.report_sha256,
    },
  });
}

export async function runEval(ev: EvalView, benchmark: BenchmarkView): Promise<void> {
  const evalId = ev.id;
  const started = new Date().toISOString();

  // Never start (or resubmit) something the chain no longer considers pending
  const current = (await agent().view<any>({ methodName: "get_eval", args: { eval_id: evalId } })) as EvalView | null;
  if (!current || current.status !== "Pending") return;

  // A previous attempt finished the run but settlement failed: resubmit, don't re-ask the model.
  const previous = await loadEvidence(evalId, "evidence");
  if (previous) {
    await submit(evalId, previous);
    console.log(`eval ${evalId}: resubmitted saved result`);
    return;
  }

  // 1. The TEE must hold this exact benchmark
  const plaintext = await loadSealedBenchmark(benchmark.id);
  if (!plaintext) {
    return failEval(evalId, "This TEE does not hold the benchmark yet; the author needs to upload it again. Refunded.");
  }
  if (sha256Hex(plaintext) !== benchmark.set_hash) {
    return failEval(evalId, "Stored benchmark does not match the on-chain hash. Refunded.");
  }
  let file;
  try {
    file = parseBenchmark(new TextDecoder().decode(plaintext));
  } catch {
    return failEval(evalId, "Stored benchmark could not be read. Refunded.");
  }
  if (file.items.length !== benchmark.item_count) {
    return failEval(evalId, "Stored benchmark item count does not match the chain. Refunded.");
  }

  // Operator policy: the operator's NEAR AI key pays for inference, so refuse runs it can't afford
  if (file.items.length > config.maxRunItems) {
    return failEval(evalId, `This agent runs at most ${config.maxRunItems} items per eval. No questions were sent. Refunded.`);
  }
  if (BigInt(ev.paid) < config.minPricePerItemYocto * BigInt(file.items.length)) {
    return failEval(evalId, "The benchmark price is below this agent's minimum per item. No questions were sent. Refunded.");
  }

  // 2. Decide Sealed vs Leak risk BEFORE any question leaves the TEE
  let attestation: ModelAttestation;
  try {
    attestation = await withRetry(() => attestModel(ev.model), 2);
  } catch (e) {
    return failEval(evalId, `Could not reach NEAR AI Cloud for "${ev.model}". No questions were sent. Refunded.`);
  }
  // the author's policy as it was when the run was paid for
  if (!attestation.sealed && !ev.allow_leak_risk) {
    return failEval(
      evalId,
      `${attestation.reason ?? "Model is not attested"}, and the author does not allow leak-risk runs. No questions were sent. Refunded.`,
    );
  }
  const mode = attestation.sealed ? "Sealed" : "LeakRisk";
  console.log(`eval ${evalId}: ${benchmark.item_count} items on ${ev.model} as ${mode}`);

  // Mark the run as started on chain so the requester can't reclaim it halfway through
  await agent().call({ methodName: "claim_eval", args: { eval_id: evalId } });

  // 3. Run and grade every item inside the TEE. In sealed mode, the first answer that isn't signed
  // by an attested model key stops the run so no further questions go out.
  const system = file.system ?? DEFAULT_SYSTEM;
  let broken = false;
  const correctFlags: boolean[] = new Array(file.items.length).fill(false);
  const records = await mapLimit(file.items, config.itemConcurrency, async (item, index): Promise<ItemRecord> => {
    try {
      const result = await withRetry(() => chat(ev.model, system, item.prompt));
      const sigRaw = attestation.sealed
        ? await checkSignature(result, ev.model, attestation).catch((e) => ({
            verified: false,
            kind: null,
            signingAddress: null,
            signature: null,
            error: String(e),
          }))
        : null;
      // only a signature from the model's own TEE proves where the question went
      const verified = !!sigRaw?.verified && sigRaw.kind === "provider_tee";
      if (attestation.sealed && !verified) broken = true;
      correctFlags[index] = grade(item, result.content);
      return {
        index,
        error: null,
        request_sha256: result.requestHash,
        response_sha256: result.responseHash,
        signature_kind: sigRaw?.kind ?? null,
        signing_address: sigRaw?.signingAddress ?? null,
        signature: sigRaw?.signature ?? null,
        signature_verified: verified,
      };
    } catch (e) {
      if (attestation.sealed) broken = true;
      return {
        index,
        // never echo upstream error bodies: they could quote the prompt
        error: "request failed",
        request_sha256: null,
        response_sha256: null,
        signature_kind: null,
        signing_address: null,
        signature: null,
        signature_verified: false,
      };
    }
  }, () => broken);

  const total = file.items.length;
  if (attestation.sealed && (broken || records.some((r) => !r || !r.signature_verified))) {
    return failEval(evalId, "An answer could not be tied to the attested model, so the run was stopped and not scored. Refunded.");
  }
  const errored = records.filter((r) => r.error).length;
  if (errored > total * 0.2) {
    return failEval(evalId, `The model failed on ${errored} of ${total} items, so no score was recorded. Refunded.`);
  }
  const correct = correctFlags.filter(Boolean).length;
  const verified = records.filter((r) => r.signature_verified).length;

  // 4. Evidence: everything needed to check the run, nothing that reveals the benchmark
  const evidence = {
    sealed_evals_version: VERSION,
    contract: config.agentContractId,
    agent_account: agent().accountId(),
    tee_mode: keys().mode,
    seal_public_key: keys().sealPublicKeyHex,
    eval_id: evalId,
    benchmark_id: benchmark.id,
    set_hash: benchmark.set_hash,
    model: ev.model,
    mode,
    started_at: started,
    finished_at: new Date().toISOString(),
    model_attestation: {
      nonce: attestation.nonce,
      report_sha256: attestation.reportSha256,
      sealed: attestation.sealed,
      not_sealed_reason: attestation.reason,
      model_signing_addresses: attestation.modelSigningAddresses,
      gateway_signing_addresses: attestation.gatewaySigningAddresses,
      nvidia: attestation.nvidia,
      // raw NVIDIA (NRAS) response, so anyone can verify its JWTs against NVIDIA's keys themselves
      nras_response: attestation.nrasRaw,
    },
    score: { correct, total, verified_responses: verified, errored },
    items: records,
  };
  const evidenceJson = JSON.stringify(evidence, null, 2);
  await saveEvidence(evalId, evidenceJson, attestation.reportJson);

  // 5. Settle: pays the author
  await submit(evalId, evidenceJson);
  console.log(`eval ${evalId}: ${correct}/${total} (${verified} verified), settled`);
}
