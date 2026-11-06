// Sealed envelope: how an author encrypts a benchmark so only the TEE can read it.
// Pure JS (noble) so the exact same code runs in the agent, the CLI and the browser.
//
//   shared = X25519(ephemeral_sk, tee_pk)
//   key    = HKDF-SHA256(ikm = shared, salt = epk || tee_pk, info = "sealed-evals/v1", 32)
//   ct     = AES-256-GCM(key, iv, plaintext, aad = "sealed-evals:v1:<contract>:<benchmarkId>")
//
// The AAD binds a ciphertext to one benchmark on one contract, so it can't be replayed
// onto another benchmark id.

import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes, bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export const ENVELOPE_VERSION = 1 as const;
export const ENVELOPE_ALG = "x25519-hkdf-sha256-aes256gcm" as const;
const HKDF_INFO = utf8ToBytes("sealed-evals/v1");

export interface SealedEnvelope {
  v: typeof ENVELOPE_VERSION;
  alg: typeof ENVELOPE_ALG;
  /** ephemeral X25519 public key, hex */
  epk: string;
  /** 12-byte nonce, hex */
  iv: string;
  /** ciphertext + GCM tag, base64 */
  ct: string;
}

export function envelopeAad(contractId: string, benchmarkId: string | number): Uint8Array {
  return utf8ToBytes(`sealed-evals:v1:${contractId}:${benchmarkId}`);
}

export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function deriveKey(shared: Uint8Array, epk: Uint8Array, teePk: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, concat(epk, teePk), HKDF_INFO, 32);
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Encrypt `plaintext` to the TEE's X25519 public key (hex). */
export function sealToTee(
  plaintext: Uint8Array,
  teePublicKeyHex: string,
  aad: Uint8Array,
): SealedEnvelope {
  const teePk = hexToBytes(teePublicKeyHex);
  if (teePk.length !== 32) throw new Error("TEE public key must be 32 bytes");
  const esk = x25519.utils.randomPrivateKey();
  const epk = x25519.getPublicKey(esk);
  const key = deriveKey(x25519.getSharedSecret(esk, teePk), epk, teePk);
  const iv = randomBytes(12);
  const ct = gcm(key, iv, aad).encrypt(plaintext);
  return { v: ENVELOPE_VERSION, alg: ENVELOPE_ALG, epk: bytesToHex(epk), iv: bytesToHex(iv), ct: toBase64(ct) };
}

/** Decrypt an envelope with the TEE's X25519 private key. Throws if tampered or mis-bound. */
export function openFromTee(env: SealedEnvelope, teePrivateKey: Uint8Array, aad: Uint8Array): Uint8Array {
  if (env?.v !== ENVELOPE_VERSION || env?.alg !== ENVELOPE_ALG) throw new Error("Unsupported envelope");
  const epk = hexToBytes(env.epk);
  const iv = hexToBytes(env.iv);
  if (epk.length !== 32 || iv.length !== 12) throw new Error("Malformed envelope");
  const teePk = x25519.getPublicKey(teePrivateKey);
  const key = deriveKey(x25519.getSharedSecret(teePrivateKey, epk), epk, teePk);
  return gcm(key, iv, aad).decrypt(fromBase64(env.ct));
}

/** Domain-separated digest the TEE puts in its quote's report_data to vouch for its seal key. */
export function sealKeyReportData(publicKeyHex: string): string {
  return sha256Hex(`sealed-evals:seal-key:v1:${publicKeyHex.toLowerCase()}`);
}

export { bytesToHex, hexToBytes, utf8ToBytes };
