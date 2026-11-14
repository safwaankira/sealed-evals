// Diagnoses why an answer's signature does or doesn't verify, using the agent's own client code
// and a harmless public prompt (never a benchmark item). Prints no keys.
// Usage: npx tsx scripts/diag-signature.ts <model-id>
import { config } from "../src/config";
import { attestModel, chat, checkSignature } from "../src/nearai/client";

const model = process.argv[2];
if (!model) throw new Error("usage: npx tsx scripts/diag-signature.ts <model-id>");

const a = await attestModel(model);
console.log("attestation:", {
  sealed: a.sealed,
  reason: a.reason,
  model_signing_addresses: a.modelSigningAddresses,
  gateway_signing_addresses: a.gatewaySigningAddresses,
  nvidia: a.nvidia && { overall: a.nvidia.overall, nonce_match: a.nvidia.nonceMatch },
});

const r = await chat(model, "Reply with only the final answer.", "What is 2 + 3?");
console.log("chat:", { chat_id: r.chatId, answer: r.content.slice(0, 40), request_sha256: r.requestHash, response_sha256: r.responseHash });

const url = `${config.nearAiBaseUrl}/v1/signature/${encodeURIComponent(r.chatId ?? "")}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`;
for (let i = 0; i < 5; i++) {
  const res = await fetch(url, { headers: { accept: "application/json", Authorization: `Bearer ${config.nearAiApiKey}` } });
  if (res.ok) {
    const sig = await res.json();
    console.log("raw signature:", { kind: sig.signature_kind, signing_address: sig.signing_address, text_parts: String(sig.text).split(":") });
    break;
  }
  console.log("signature lookup status", res.status);
  await new Promise((s) => setTimeout(s, 1000));
}
console.log("our check:", await checkSignature(r, model, a));
