// At-rest storage inside the TEE. Benchmarks are re-encrypted with a TEE-derived storage
// key before touching disk, so even the (already encrypted) Phala volume never holds a
// plaintext benchmark. Evidence files are public by design and stored as plain JSON.

import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils";
import { config } from "../config";
import { keys } from "./keys";

const benchmarksDir = () => join(config.dataDir, "benchmarks");
const evidenceDir = () => join(config.dataDir, "evidence");

function safeId(id: string | number): string {
  const s = String(id);
  if (!/^\d{1,20}$/.test(s)) throw new Error("Invalid id");
  return s;
}

function storeAad(benchmarkId: string): Uint8Array {
  return utf8ToBytes(`sealed-evals:store:v1:${config.agentContractId}:${benchmarkId}`);
}

export async function initStore(): Promise<void> {
  await mkdir(benchmarksDir(), { recursive: true });
  await mkdir(evidenceDir(), { recursive: true });
}

export async function saveSealedBenchmark(benchmarkId: string | number, plaintext: Uint8Array): Promise<void> {
  const id = safeId(benchmarkId);
  const iv = randomBytes(12);
  const ct = gcm(keys().storageKey, iv, storeAad(id)).encrypt(plaintext);
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  await writeFile(join(benchmarksDir(), `${id}.sealed`), out);
}

/** Returns the plaintext bytes, or null if this TEE doesn't hold the benchmark. */
export async function loadSealedBenchmark(benchmarkId: string | number): Promise<Uint8Array | null> {
  const id = safeId(benchmarkId);
  const path = join(benchmarksDir(), `${id}.sealed`);
  if (!existsSync(path)) return null;
  const buf = new Uint8Array(await readFile(path));
  return gcm(keys().storageKey, buf.subarray(0, 12), storeAad(id)).decrypt(buf.subarray(12));
}

export function hasSealedBenchmark(benchmarkId: string | number): boolean {
  return existsSync(join(benchmarksDir(), `${safeId(benchmarkId)}.sealed`));
}

export async function saveEvidence(evalId: string | number, evidence: string, attestation: string): Promise<void> {
  const id = safeId(evalId);
  await writeFile(join(evidenceDir(), `${id}.evidence.json`), evidence);
  await writeFile(join(evidenceDir(), `${id}.attestation.json`), attestation);
}

export async function loadEvidence(evalId: string | number, kind: "evidence" | "attestation"): Promise<string | null> {
  const path = join(evidenceDir(), `${safeId(evalId)}.${kind}.json`);
  return existsSync(path) ? readFile(path, "utf8") : null;
}
