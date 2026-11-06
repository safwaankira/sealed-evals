// NEAR AI Cloud client with the checks that decide whether a run is "Sealed".
// Ported and adapted from near-examples/nearai-cloud-verification-example (MIT).
//
// A model counts as sealed only if, for a fresh random nonce:
//   1. NEAR AI returns model attestations (the model is served from TEE nodes) that echo the nonce,
//   2. NVIDIA's attestation service (NRAS, reached over TLS from inside our TEE) says the GPU
//      attestation passed and its eat_nonce equals our nonce,
//   3. each answer is then signed by a key that appears in that attestation report.
// Anything short of that is "leak risk": we can't show the questions stayed in attested hardware.

import { ethers } from "ethers";
import { randomBytes } from "crypto";
import { config } from "../config";
import { sha256Hex } from "../shared/envelope";

const auth = () => ({ Authorization: `Bearer ${config.nearAiApiKey}` });

async function httpError(res: Response, context: string): Promise<Error> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 200);
  } catch {
    /* ignore */
  }
  return new Error(`${context}: ${res.status}${detail ? ` ${detail}` : ""}`);
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 120_000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

export interface ModelInfo {
  id: string;
  owned_by?: string;
}

let modelsCache: { at: number; models: ModelInfo[] } | null = null;

export async function listModels(): Promise<ModelInfo[]> {
  if (modelsCache && Date.now() - modelsCache.at < 10 * 60_000) return modelsCache.models;
  const res = await fetchWithTimeout(`${config.nearAiBaseUrl}/v1/models`, { headers: auth() }, 30_000);
  if (!res.ok) throw await httpError(res, "Listing models failed");
  const json = (await res.json()) as { data?: ModelInfo[] };
  const models = (json.data ?? []).map((m) => ({ id: m.id, owned_by: m.owned_by }));
  modelsCache = { at: Date.now(), models };
  return models;
}

// ---------- Attestation ----------

export interface NvidiaSummary {
  overall: boolean;
  eatNonce: string | null;
  nonceMatch: boolean;
  gpus: { key: string; hwmodel: string | null; measres: string | null; secboot: boolean | null }[];
}

export interface ModelAttestation {
  sealed: boolean;
  /** Why the model is not sealed, when it isn't */
  reason: string | null;
  nonce: string;
  reportJson: string;
  reportSha256: string;
  modelSigningAddresses: string[];
  gatewaySigningAddresses: string[];
  nvidia: NvidiaSummary | null;
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** NRAS answers [["JWT", overall], {"GPU-0": token, ...}] */
export function summarizeNras(nras: unknown, nonce: string): NvidiaSummary {
  const decoded: Record<string, any> = {};
  if (Array.isArray(nras)) {
    for (const item of nras) {
      if (Array.isArray(item) && item.length === 2 && typeof item[1] === "string") {
        decoded[item[0]] = decodeJwtPayload(item[1]);
      } else if (item && typeof item === "object") {
        for (const [k, v] of Object.entries(item)) {
          if (typeof v === "string") decoded[k] = decodeJwtPayload(v);
        }
      }
    }
  }
  const overallClaims = decoded.JWT ?? {};
  const eatNonce: string | null = overallClaims.eat_nonce ?? null;
  return {
    overall: overallClaims["x-nvidia-overall-att-result"] === true,
    eatNonce,
    nonceMatch: !!eatNonce && eatNonce.toLowerCase() === nonce.toLowerCase(),
    gpus: Object.entries(decoded)
      .filter(([k]) => k.startsWith("GPU-"))
      .map(([key, c]) => ({
        key,
        hwmodel: c?.hwmodel ?? null,
        measres: c?.measres ?? null,
        secboot: c?.secboot ?? null,
      })),
  };
}

async function verifyWithNvidia(nvidiaPayload: unknown, nonce: string): Promise<NvidiaSummary> {
  const body = typeof nvidiaPayload === "string" ? nvidiaPayload : JSON.stringify(nvidiaPayload);
  const res = await fetchWithTimeout(
    config.nvidiaNrasUrl,
    { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body },
    60_000,
  );
  if (!res.ok) throw await httpError(res, "NVIDIA attestation failed");
  return summarizeNras(await res.json(), nonce);
}

export async function attestModel(model: string): Promise<ModelAttestation> {
  const nonce = randomBytes(32).toString("hex");
  const params = new URLSearchParams({ model, nonce, signing_algo: "ecdsa" });
  const res = await fetchWithTimeout(`${config.nearAiBaseUrl}/v1/attestation/report?${params}`, { headers: auth() }, 60_000);
  if (!res.ok) throw await httpError(res, "Attestation request failed");
  const reportJson = await res.text();
  const report = JSON.parse(reportJson);

  const modelAttestations: any[] = Array.isArray(report.model_attestations) ? report.model_attestations : [];
  const modelSigningAddresses = [
    ...new Set(modelAttestations.map((a) => a?.signing_address).filter((a): a is string => typeof a === "string")),
  ];
  const gatewayAddr = report.gateway_attestation?.signing_address;
  const gatewaySigningAddresses = typeof gatewayAddr === "string" ? [gatewayAddr] : [];

  const base = {
    nonce,
    reportJson,
    reportSha256: sha256Hex(reportJson),
    modelSigningAddresses,
    gatewaySigningAddresses,
  };

  if (modelAttestations.length === 0 || modelSigningAddresses.length === 0) {
    return { ...base, sealed: false, reason: "Model is not served from an attested TEE", nvidia: null };
  }
  const echoed = report.request_nonce ?? report.nonce ?? modelAttestations[0]?.request_nonce;
  if (typeof echoed === "string" && echoed.toLowerCase() !== nonce) {
    return { ...base, sealed: false, reason: "Attestation did not echo our nonce", nvidia: null };
  }
  const payload = modelAttestations.find((a) => a?.nvidia_payload)?.nvidia_payload;
  if (!payload) {
    return { ...base, sealed: false, reason: "No GPU attestation in the report", nvidia: null };
  }
  let nvidia: NvidiaSummary;
  try {
    nvidia = await verifyWithNvidia(payload, nonce);
  } catch (e) {
    return { ...base, sealed: false, reason: `GPU attestation could not be verified (${(e as Error).message.slice(0, 80)})`, nvidia: null };
  }
  if (!nvidia.overall) return { ...base, sealed: false, reason: "NVIDIA rejected the GPU attestation", nvidia };
  if (!nvidia.nonceMatch) return { ...base, sealed: false, reason: "GPU attestation nonce mismatch", nvidia };
  return { ...base, sealed: true, reason: null, nvidia };
}

// ---------- Chat + signature ----------

export interface ChatResult {
  content: string;
  chatId: string | null;
  requestHash: string;
  responseHash: string;
}

export async function chat(model: string, system: string, prompt: string): Promise<ChatResult> {
  // The exact bytes sent and received are what the TEE signs, so hash those exact strings.
  const requestBody = JSON.stringify({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    max_tokens: config.maxTokens,
    stream: false,
  });
  const res = await fetchWithTimeout(`${config.nearAiBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...auth() },
    body: requestBody,
  });
  if (!res.ok) throw await httpError(res, "Chat completion failed");
  const responseText = await res.text();
  const json = JSON.parse(responseText);
  return {
    content: String(json?.choices?.[0]?.message?.content ?? ""),
    chatId: typeof json?.id === "string" ? json.id : null,
    requestHash: sha256Hex(requestBody),
    responseHash: sha256Hex(responseText),
  };
}

export interface SignatureCheck {
  verified: boolean;
  kind: "provider_tee" | "gateway" | null;
  signingAddress: string | null;
  signature: string | null;
  error: string | null;
}

export async function checkSignature(
  chatResult: ChatResult,
  model: string,
  attestation: Pick<ModelAttestation, "modelSigningAddresses" | "gatewaySigningAddresses">,
): Promise<SignatureCheck> {
  const fail = (error: string): SignatureCheck => ({ verified: false, kind: null, signingAddress: null, signature: null, error });
  if (!chatResult.chatId) return fail("No chat id");

  const url = `${config.nearAiBaseUrl}/v1/signature/${encodeURIComponent(chatResult.chatId)}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`;
  let sig: any = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetchWithTimeout(url, { headers: { accept: "application/json", ...auth() } }, 30_000);
    if (res.ok) {
      sig = await res.json();
      break;
    }
    // the signature lives on the node that served the request; other nodes 404
    if (res.status !== 404 || attempt === 5) return fail(`Signature lookup failed (${res.status})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!sig || typeof sig.text !== "string" || typeof sig.signature !== "string") return fail("Malformed signature");

  const parts = sig.text.split(":");
  const kind: "provider_tee" | "gateway" =
    sig.signature_kind === "provider_tee" || sig.signature_kind === "gateway"
      ? sig.signature_kind
      : parts.length === 3
        ? "provider_tee"
        : "gateway";
  if (parts.length !== (kind === "provider_tee" ? 3 : 2)) return fail("Signature kind does not match signed text");
  if (kind === "provider_tee" && parts[0] !== model) return fail("Model TEE signature is for a different model");
  const [reqHash, resHash] = kind === "provider_tee" ? [parts[1], parts[2]] : [parts[0], parts[1]];
  if (reqHash !== chatResult.requestHash || resHash !== chatResult.responseHash) return fail("Signed hashes do not match");

  let recovered: string;
  try {
    recovered = ethers.verifyMessage(sig.text, sig.signature);
  } catch (e) {
    return fail(`Bad signature (${(e as Error).message.slice(0, 60)})`);
  }
  const expected = kind === "provider_tee" ? attestation.modelSigningAddresses : attestation.gatewaySigningAddresses;
  const ok = expected.some((a) => a.toLowerCase() === recovered.toLowerCase());
  return {
    verified: ok,
    kind,
    signingAddress: recovered,
    signature: sig.signature,
    error: ok ? null : "Signer is not in the attestation report",
  };
}
