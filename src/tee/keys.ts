// The agent's seal key: an X25519 key pair that only exists inside the TEE.
//
// In the TEE, keys come from dstack's KMS (`getKey`), which derives them from the app's
// identity, so they survive restarts and redeploys of the same Phala app but no other
// code can obtain them. The TEE then produces a TDX quote whose report_data commits to
// the seal public key, so an author can check the key really belongs to attested code
// before encrypting anything to it.
//
// Outside a TEE (local development) keys are derived from a local secret and every
// response says mode "local" so nobody mistakes it for a sealed setup.

import { existsSync } from "fs";
import { DstackClient } from "@phala/dstack-sdk";
import { x25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { config } from "../config";
import { sealKeyReportData } from "../shared/envelope";

export interface TeeKeys {
  mode: "tee" | "local";
  sealPrivateKey: Uint8Array;
  sealPublicKeyHex: string;
  storageKey: Uint8Array;
  /** sha256 commitment to the seal key, placed in the quote's report_data */
  reportData: string;
  /** TDX quote (hex) whose report_data is `reportData`; null in local mode */
  quote: string | null;
  appId: string | null;
  composeHash: string | null;
}

function domainHash(label: string, material: Uint8Array): Uint8Array {
  const prefix = utf8ToBytes(`sealed-evals:${label}:`);
  const buf = new Uint8Array(prefix.length + material.length);
  buf.set(prefix, 0);
  buf.set(material, prefix.length);
  return sha256(buf);
}

let cached: TeeKeys | null = null;

export async function initKeys(): Promise<TeeKeys> {
  if (cached) return cached;

  if (existsSync("/var/run/dstack.sock")) {
    const client = new DstackClient();
    const sealMaterial = (await client.getKey("sealed-evals/seal/v1", "x25519")).key;
    const storageMaterial = (await client.getKey("sealed-evals/storage/v1", "aes")).key;
    const sealPrivateKey = domainHash("x25519", sealMaterial);
    const sealPublicKeyHex = bytesToHex(x25519.getPublicKey(sealPrivateKey));
    const reportData = sealKeyReportData(sealPublicKeyHex);
    const quoteRes = await client.getQuote(hexToBytes(reportData));
    let appId: string | null = null;
    let composeHash: string | null = null;
    try {
      const info = await client.info();
      appId = info.app_id ?? null;
      composeHash = info.compose_hash ?? (info.tcb_info as any)?.compose_hash ?? null;
    } catch {
      // info is optional context for the UI
    }
    cached = {
      mode: "tee",
      sealPrivateKey,
      sealPublicKeyHex,
      storageKey: domainHash("storage", storageMaterial),
      reportData,
      quote: quoteRes.quote,
      appId,
      composeHash,
    };
  } else {
    const secret = utf8ToBytes(config.localSealSecret || `local:${config.sponsorPrivateKey}`);
    const sealPrivateKey = domainHash("local-x25519", secret);
    const sealPublicKeyHex = bytesToHex(x25519.getPublicKey(sealPrivateKey));
    cached = {
      mode: "local",
      sealPrivateKey,
      sealPublicKeyHex,
      storageKey: domainHash("local-storage", secret),
      reportData: sealKeyReportData(sealPublicKeyHex),
      quote: null,
      appId: null,
      composeHash: null,
    };
  }
  return cached;
}

/**
 * A fresh quote binding the seal key to a caller-chosen nonce, so a verifier knows the
 * quote was produced just now rather than replayed. report_data = sha256(reportData:nonce).
 */
export async function freshSealKeyQuote(nonceHex: string): Promise<{ reportData: string; quote: string } | null> {
  const k = keys();
  if (k.mode !== "tee") return null;
  const reportData = bytesToHex(sha256(utf8ToBytes(`${k.reportData}:${nonceHex.toLowerCase()}`)));
  const client = new DstackClient();
  const res = await client.getQuote(hexToBytes(reportData));
  return { reportData, quote: res.quote };
}

export function keys(): TeeKeys {
  if (!cached) throw new Error("Keys not initialised");
  return cached;
}
