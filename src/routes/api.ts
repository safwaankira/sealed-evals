import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { agent } from "../near/agent";
import { config, VERSION } from "../config";
import { keys, freshSealKeyQuote } from "../tee/keys";
import { envelopeAad, openFromTee, sha256Hex, type SealedEnvelope } from "../shared/envelope";
import { LIMITS, parseBenchmark } from "../shared/benchmark";
import { hasSealedBenchmark, loadEvidence, saveSealedBenchmark } from "../tee/store";
import { listModels } from "../nearai/client";
import { workerStatus } from "../eval/worker";
import type { BenchmarkView } from "../near/types";

const api = new Hono();

api.get("/health", (c) => c.json({ ok: true }));

api.get("/agent-info", async (c) => {
  const k = keys();
  return c.json({
    version: VERSION,
    account_id: agent().accountId(),
    balance: await agent().balance().catch(() => null),
    contract_id: config.agentContractId,
    network: config.networkId,
    tee_mode: k.mode,
    seal_public_key: k.sealPublicKeyHex,
    app_id: k.appId,
    compose_hash: k.composeHash,
    worker: workerStatus(),
  });
});

// The key authors encrypt benchmarks to, plus a TDX quote proving it lives in this TEE.
api.get("/seal-key", async (c) => {
  const k = keys();
  const nonce = c.req.query("nonce");
  if (nonce !== undefined && !/^[0-9a-fA-F]{64}$/.test(nonce)) {
    return c.json({ error: "nonce must be 32 bytes of hex" }, 400);
  }
  const fresh = nonce ? await freshSealKeyQuote(nonce) : null;
  return c.json({
    tee_mode: k.mode,
    public_key: k.sealPublicKeyHex,
    // report_data = sha256("sealed-evals:seal-key:v1:<public_key>"), or sha256(that + ":" + nonce) when a nonce is given
    report_data: fresh?.reportData ?? k.reportData,
    quote: fresh?.quote ?? k.quote,
    nonce: nonce ?? null,
    app_id: k.appId,
    compose_hash: k.composeHash,
    verify: k.mode === "tee"
      ? "Paste the quote into https://proof.t16z.com to verify it, then check its report_data matches."
      : "LOCAL MODE: this key is not in a TEE. Do not seal real benchmarks to it.",
  });
});

api.get("/benchmarks/:id/status", (c) => {
  const id = c.req.param("id");
  if (!/^\d{1,20}$/.test(id)) return c.json({ error: "bad id" }, 400);
  return c.json({ benchmark_id: id, held_by_this_tee: hasSealedBenchmark(id) });
});

// Authors upload the encrypted benchmark here. It is only accepted if it decrypts inside the
// TEE and hashes to the set_hash the author registered on chain.
api.post(
  "/benchmarks/:id/upload",
  bodyLimit({ maxSize: Math.ceil(LIMITS.maxFileBytes * 1.5), onError: (c) => c.json({ error: "Upload too large" }, 413) }),
  async (c) => {
    const id = c.req.param("id");
    if (!/^\d{1,20}$/.test(id)) return c.json({ error: "bad id" }, 400);

    const benchmark = (await agent().view<any>({ methodName: "get_benchmark", args: { benchmark_id: id } })) as BenchmarkView | null;
    if (!benchmark) return c.json({ error: "Benchmark is not registered on chain" }, 404);
    if (!benchmark.active) return c.json({ error: "Benchmark is retired" }, 409);

    let envelope: SealedEnvelope;
    try {
      envelope = await c.req.json();
    } catch {
      return c.json({ error: "Body must be a sealed envelope (JSON)" }, 400);
    }

    let plaintext: Uint8Array;
    try {
      plaintext = openFromTee(envelope, keys().sealPrivateKey, envelopeAad(config.agentContractId, id));
    } catch {
      return c.json({ error: "Could not decrypt. Was it sealed to this TEE's key for this benchmark id?" }, 400);
    }
    if (plaintext.length > LIMITS.maxFileBytes) return c.json({ error: "Benchmark too large" }, 413);
    if (sha256Hex(plaintext) !== benchmark.set_hash) {
      return c.json({ error: "Decrypted file does not match the set_hash registered on chain" }, 400);
    }

    let itemCount: number;
    try {
      itemCount = parseBenchmark(new TextDecoder().decode(plaintext)).items.length;
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    if (benchmark.item_count && benchmark.item_count !== itemCount) {
      return c.json({ error: "Item count differs from the sealed set" }, 409);
    }

    const already = benchmark.sealed && benchmark.sealed_by === agent().accountId() && hasSealedBenchmark(id);
    await saveSealedBenchmark(id, plaintext);
    if (already) {
      return c.json({ ok: true, benchmark_id: id, item_count: itemCount, sealed_by: agent().accountId(), already_sealed: true });
    }
    try {
      await agent().call({ methodName: "seal_benchmark", args: { benchmark_id: id, item_count: itemCount } });
    } catch (e) {
      return c.json({ error: "Stored in the TEE, but recording the seal on chain failed. Try again." }, 502);
    }
    return c.json({ ok: true, benchmark_id: id, item_count: itemCount, sealed_by: agent().accountId() });
  },
);

api.get("/evals/:id/evidence", async (c) => {
  const id = c.req.param("id");
  if (!/^\d{1,20}$/.test(id)) return c.json({ error: "bad id" }, 400);
  const body = await loadEvidence(id, "evidence");
  if (!body) return c.json({ error: "No evidence for this eval" }, 404);
  return c.body(body, 200, { "content-type": "application/json" });
});

api.get("/evals/:id/attestation", async (c) => {
  const id = c.req.param("id");
  if (!/^\d{1,20}$/.test(id)) return c.json({ error: "bad id" }, 400);
  const body = await loadEvidence(id, "attestation");
  if (!body) return c.json({ error: "No attestation for this eval" }, 404);
  return c.body(body, 200, { "content-type": "application/json" });
});

api.get("/models", async (c) => {
  try {
    return c.json({ models: await listModels() });
  } catch {
    return c.json({ error: "Could not list NEAR AI Cloud models" }, 502);
  }
});

export default api;
