// End-to-end run of the agent's logic against a mock NEAR AI Cloud + NVIDIA service and a fake
// contract client: seal → upload → sealed run → refused leak-risk run → allowed leak-risk run.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Wallet } from "ethers";

const sample = readFileSync(new URL("../frontend/public/sample-benchmark.json", import.meta.url));
const sampleJson = JSON.parse(sample.toString());
const answers = new Map<string, string>(sampleJson.items.map((i: any) => [i.prompt, i.answer]));
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

const modelKey = Wallet.createRandom();
const gatewayKey = Wallet.createRandom();
const evilKey = Wallet.createRandom();
const chats = new Map<string, { model: string; req: string; res: string }>();
let chatCount = 0;
const promptsSeenBy = new Map<string, number>();

function jwt(payload: object) {
  return `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, "http://x");
  let body = "";
  for await (const chunk of req) body += chunk;
  const send = (status: number, text: string) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(text);
  };
  if (url.pathname === "/v1/attestation/report") {
    const model = url.searchParams.get("model")!;
    const nonce = url.searchParams.get("nonce")!;
    const tee = model.startsWith("tee/");
    return send(200, JSON.stringify({
      request_nonce: nonce,
      model_attestations: tee ? [{ signing_address: modelKey.address, nvidia_payload: { nonce } }] : [],
      gateway_attestation: { signing_address: gatewayKey.address },
    }));
  }
  if (url.pathname === "/nras") {
    const p = JSON.parse(body);
    return send(200, JSON.stringify([["JWT", jwt({ "x-nvidia-overall-att-result": true, eat_nonce: p.nonce })], { "GPU-0": jwt({ hwmodel: "GH100 BETA", measres: "success" }) }]));
  }
  if (url.pathname === "/v1/chat/completions") {
    const r = JSON.parse(body);
    const prompt = r.messages[1].content;
    promptsSeenBy.set(r.model, (promptsSeenBy.get(r.model) ?? 0) + 1);
    // the mock model gets exactly one question wrong
    let content = answers.get(prompt) ?? "?";
    if (prompt.startsWith("What is the capital")) content = "Sydney";
    if (prompt.includes("backwards")) content = "<think>reverse it</think>yrassecen";
    const id = `chat-${++chatCount}`;
    const text = JSON.stringify({ id, choices: [{ message: { role: "assistant", content } }] });
    chats.set(id, { model: r.model, req: sha(body), res: sha(text) });
    return send(200, text);
  }
  const m = url.pathname.match(/^\/v1\/signature\/(.+)$/);
  if (m) {
    const c = chats.get(decodeURIComponent(m[1]));
    if (!c) return send(404, "{}");
    const text = `${c.model}:${c.req}:${c.res}`;
    const signer = c.model === "tee/evil" ? evilKey : modelKey;
    return send(200, JSON.stringify({ text, signature: signer.signMessageSync(text), signing_algo: "ecdsa", signature_kind: "provider_tee" }));
  }
  send(404, "{}");
});

// Fake contract client
const calls: { methodName: string; args: any }[] = [];
const settled = new Set<string>();
const benchmark: any = {
  id: "0",
  author: "author.testnet",
  name: "Practice",
  description: "",
  set_hash: sha(sample),
  price: "1000000000000000000000000",
  allow_leak_risk: false,
  active: true,
  item_count: 0,
  sealed: false,
  sealed_by: null,
};
const fakeAgent = {
  accountId: () => "agent.testnet",
  balance: async () => 1,
  fund: async () => {},
  view: async ({ methodName, args }: any) => {
    if (methodName === "get_benchmark") return { ...benchmark };
    if (methodName === "get_eval") return { id: args.eval_id, status: settled.has(args.eval_id) ? "Completed" : "Pending" };
    return null;
  },
  call: async (c: any) => {
    calls.push(c);
    if (c.methodName === "submit_result") settled.add(c.args.eval_id);
    if (c.methodName === "seal_benchmark") Object.assign(benchmark, { item_count: c.args.item_count, sealed: true, sealed_by: "agent.testnet" });
    return true;
  },
};

let mods: any;
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as any).port;
  Object.assign(process.env, {
    AGENT_CONTRACT_ID: "sealed.testnet",
    SPONSOR_ACCOUNT_ID: "sponsor.testnet",
    SPONSOR_PRIVATE_KEY: "ed25519:test",
    NEARAI_CLOUD_API_KEY: "sk-test",
    NEARAI_CLOUD_BASE_URL: `http://127.0.0.1:${port}`,
    NVIDIA_NRAS_URL: `http://127.0.0.1:${port}/nras`,
    DATA_DIR: mkdtempSync(join(tmpdir(), "sealed-")),
    LOCAL_SEAL_SECRET: "e2e",
  });
  const agentMod = await import("../src/near/agent");
  agentMod.setAgentForTests(fakeAgent);
  const keys = await import("../src/tee/keys");
  await keys.initKeys();
  await (await import("../src/tee/store")).initStore();
  mods = {
    keys,
    envelope: await import("../src/shared/envelope"),
    api: (await import("../src/routes/api")).default,
    runner: await import("../src/eval/runner"),
    store: await import("../src/tee/store"),
  };
});
after(() => server.close());

const upload = (id: string, env: unknown) =>
  mods.api.request(`/benchmarks/${id}/upload`, { method: "POST", body: JSON.stringify(env), headers: { "content-type": "application/json" } });

test("upload rejects a file sealed for another benchmark id", async () => {
  const { sealToTee, envelopeAad } = mods.envelope;
  const env = sealToTee(new Uint8Array(sample), mods.keys.keys().sealPublicKeyHex, envelopeAad("sealed.testnet", 9));
  const res = await upload("0", env);
  assert.equal(res.status, 400);
});

test("upload rejects a file whose hash differs from the chain", async () => {
  const { sealToTee, envelopeAad, utf8ToBytes } = mods.envelope;
  const other = utf8ToBytes(JSON.stringify({ items: [{ prompt: "x", answer: "y" }] }));
  const res = await upload("0", sealToTee(other, mods.keys.keys().sealPublicKeyHex, envelopeAad("sealed.testnet", 0)));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /set_hash/);
});

test("upload refuses benchmarks from authors outside the operator's list", async () => {
  const { sealToTee, envelopeAad } = mods.envelope;
  benchmark.author = "stranger.testnet";
  try {
    const res = await upload("0", sealToTee(new Uint8Array(sample), mods.keys.keys().sealPublicKeyHex, envelopeAad("sealed.testnet", 0)));
    assert.equal(res.status, 403);
  } finally {
    benchmark.author = "author.testnet";
  }
});

test("author seals the benchmark", async () => {
  const { sealToTee, envelopeAad } = mods.envelope;
  const res = await upload("0", sealToTee(new Uint8Array(sample), mods.keys.keys().sealPublicKeyHex, envelopeAad("sealed.testnet", 0)));
  assert.equal(res.status, 200, await res.clone().text());
  const sealCall = calls.find((c) => c.methodName === "seal_benchmark");
  assert.deepEqual(sealCall?.args, { benchmark_id: "0", item_count: 12 });
  assert.ok(mods.store.hasSealedBenchmark("0"));
  // nothing readable on disk
  const onDisk = readFileSync(join(process.env.DATA_DIR!, "benchmarks", "0.sealed"));
  assert.ok(!onDisk.toString("latin1").includes("Canberra"));
});

const ev = (id: string, model: string, allow_leak_risk = false) => ({
  id, requester: "r.testnet", benchmark_id: "0", model, paid: "1000000000000000000000000",
  status: "Pending", created_ms: "1", allow_leak_risk, claimed_ms: null, result: null, failure_reason: null,
});

test("sealed run scores inside the TEE with verified signatures", async () => {
  calls.length = 0;
  await mods.runner.runEval(ev("1", "tee/qwen"), { ...benchmark });
  const submit = calls.find((c) => c.methodName === "submit_result");
  assert.ok(submit, JSON.stringify(calls));
  assert.equal(submit!.args.mode, "Sealed");
  assert.equal(submit!.args.total, 12);
  assert.equal(submit!.args.correct, 11);
  assert.equal(submit!.args.verified_responses, 12);
  assert.ok(calls.findIndex((c) => c.methodName === "claim_eval") < calls.indexOf(submit!), "claims before settling");

  const evidence = await mods.store.loadEvidence("1", "evidence");
  assert.equal(sha(evidence), submit!.args.evidence_hash);
  const attestation = await mods.store.loadEvidence("1", "attestation");
  assert.equal(sha(attestation), submit!.args.model_attestation_hash);
  for (const item of sampleJson.items) {
    assert.ok(!evidence.includes(item.prompt.slice(0, 20)), "evidence must not contain prompts");
  }
  assert.ok(!evidence.includes("Canberra") && !evidence.includes("Sydney"), "evidence must not contain answers");
  assert.ok(!evidence.includes('"correct": true'), "no per-item correctness in public evidence");
  assert.ok(JSON.parse(evidence).model_attestation.nras_response, "raw NVIDIA response kept for independent checks");
});

test("a saved result is resubmitted without asking the model again", async () => {
  settled.delete("1");
  calls.length = 0;
  const before = promptsSeenBy.get("tee/qwen");
  await mods.runner.runEval(ev("1", "tee/qwen"), { ...benchmark });
  assert.equal(promptsSeenBy.get("tee/qwen"), before);
  assert.equal(calls[0].methodName, "submit_result");
});

test("settled evals are never run again", async () => {
  calls.length = 0;
  await mods.runner.runEval(ev("1", "tee/qwen"), { ...benchmark });
  assert.equal(calls.length, 0);
});

test("unattested model is refused before any question is sent", async () => {
  calls.length = 0;
  // the author allows leak risk now, but didn't when this run was paid for: the snapshot wins
  await mods.runner.runEval(ev("2", "closed/gpt", false), { ...benchmark, allow_leak_risk: true });
  assert.equal(calls[0].methodName, "fail_eval");
  assert.match(calls[0].args.reason, /No questions were sent/);
  assert.equal(promptsSeenBy.get("closed/gpt") ?? 0, 0);
});

test("leak risk run happens only when the author allowed it, and is labeled", async () => {
  calls.length = 0;
  await mods.runner.runEval(ev("3", "closed/gpt", true), { ...benchmark, allow_leak_risk: true });
  const submit = calls.find((c) => c.methodName === "submit_result")!;
  assert.equal(submit.args.mode, "LeakRisk");
  assert.equal(submit.args.verified_responses, 0);
  assert.equal(promptsSeenBy.get("closed/gpt"), 12);
});

test("an answer signed by an unattested key stops a sealed run and refunds it", async () => {
  calls.length = 0;
  await mods.runner.runEval(ev("4", "tee/evil"), { ...benchmark });
  assert.ok(!calls.some((c) => c.methodName === "submit_result"));
  assert.match(calls.find((c) => c.methodName === "fail_eval")!.args.reason, /stopped/);
  assert.ok((promptsSeenBy.get("tee/evil") ?? 0) < 12, "stops sending questions early");
});

test("runs priced below the operator minimum are refused before any question", async () => {
  calls.length = 0;
  await mods.runner.runEval({ ...ev("5", "tee/cheap"), paid: "1" }, { ...benchmark });
  assert.match(calls[0].args.reason, /minimum/);
  assert.equal(promptsSeenBy.get("tee/cheap") ?? 0, 0);
});

test("models outside the operator's list are refused before any question", async () => {
  calls.length = 0;
  await mods.runner.runEval(ev("6", "tee/pricey"), { ...benchmark });
  assert.equal(calls[0].methodName, "fail_eval");
  assert.match(calls[0].args.reason, /only sends questions to/);
  assert.equal(promptsSeenBy.get("tee/pricey") ?? 0, 0);
});

test("benchmarks from authors outside the operator's list are refused", async () => {
  calls.length = 0;
  await mods.runner.runEval(ev("7", "tee/qwen"), { ...benchmark, author: "stranger.testnet" });
  assert.match(calls[0].args.reason, /approved authors/);
});

test("evidence is served over the API", async () => {
  const res = await mods.api.request("/evals/1/evidence");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).mode, "Sealed");
  assert.equal((await mods.api.request("/evals/99/evidence")).status, 404);
  // evidence for an unsettled run stays private
  assert.equal((await mods.api.request("/evals/3/attestation")).status, 200);
  settled.delete("3");
  assert.equal((await mods.api.request("/evals/3/evidence")).status, 404);
  assert.equal((await mods.api.request("/evals/..%2F..%2Fx/evidence")).status, 400);
});

test("seal key endpoint is honest about local mode", async () => {
  const res = await mods.api.request("/seal-key");
  const body = await res.json();
  assert.equal(body.tee_mode, "local");
  assert.equal(body.quote, null);
  assert.equal(body.report_data, mods.envelope.sealKeyReportData(body.public_key));
});
