import { test } from "node:test";
import assert from "node:assert/strict";
import { x25519 } from "@noble/curves/ed25519";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { envelopeAad, openFromTee, sealToTee, sha256Hex } from "../src/shared/envelope";
import { grade, parseBenchmark, stripReasoning } from "../src/shared/benchmark";
import { summarizeNras } from "../src/nearai/client";

const sk = x25519.utils.randomPrivateKey();
const pk = bytesToHex(x25519.getPublicKey(sk));

test("envelope round-trips", () => {
  const msg = utf8ToBytes(JSON.stringify({ items: [{ prompt: "2+2?", answer: "4" }] }));
  const aad = envelopeAad("c.testnet", 7);
  const env = sealToTee(msg, pk, aad);
  assert.deepEqual(openFromTee(env, sk, aad), msg);
});

test("envelope is bound to its benchmark id", () => {
  const env = sealToTee(utf8ToBytes("x"), pk, envelopeAad("c.testnet", 7));
  assert.throws(() => openFromTee(env, sk, envelopeAad("c.testnet", 8)));
  assert.throws(() => openFromTee(env, sk, envelopeAad("other.testnet", 7)));
});

test("envelope rejects tampering and wrong keys", () => {
  const aad = envelopeAad("c.testnet", 1);
  const env = sealToTee(utf8ToBytes("secret"), pk, aad);
  const bad = { ...env, ct: env.ct.slice(0, -4) + (env.ct.endsWith("AAAA") ? "BBBB" : "AAAA") };
  assert.throws(() => openFromTee(bad, sk, aad));
  assert.throws(() => openFromTee(env, x25519.utils.randomPrivateKey(), aad));
});

test("sha256Hex matches known vector", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("parseBenchmark validates", () => {
  assert.equal(parseBenchmark('{"items":[{"prompt":"a","answer":"b"}]}').items.length, 1);
  assert.throws(() => parseBenchmark("nope"), /valid JSON/);
  assert.throws(() => parseBenchmark('{"items":[]}'), /1-2000/);
  assert.throws(() => parseBenchmark('{"items":[{"prompt":"a"}]}'), /answer/);
  assert.throws(() => parseBenchmark('{"items":[{"prompt":"a","answer":"b","grader":"vibes"}]}'), /grader/);
});

test("graders", () => {
  assert.ok(grade({ prompt: "", answer: "Paris" }, "paris."));
  assert.ok(grade({ prompt: "", answer: "Paris" }, "Answer: Paris"));
  assert.ok(!grade({ prompt: "", answer: "Paris" }, "It is Paris, France"));
  assert.ok(grade({ prompt: "", answer: "Paris", grader: "contains" }, "It is Paris, France"));
  assert.ok(grade({ prompt: "", answer: "1,250", grader: "number" }, "The total is 1,250 apples"));
  assert.ok(grade({ prompt: "", answer: "42", grader: "number" }, "<think>maybe 41</think>42"));
  assert.ok(!grade({ prompt: "", answer: "42", grader: "number" }, "41"));
  assert.ok(grade({ prompt: "", answer: "c", grader: "choice" }, "C) because"));
  assert.ok(grade({ prompt: "", answer: "B", grader: "choice" }, "The answer is (B)"));
  assert.ok(!grade({ prompt: "", answer: "B", grader: "choice" }, "A"));
  assert.equal(stripReasoning("<think>x</think> hi"), "hi");
});

function jwt(payload: object) {
  return `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
}

test("NRAS summary checks result and nonce", () => {
  const nonce = "ab".repeat(32);
  const ok = summarizeNras([["JWT", jwt({ "x-nvidia-overall-att-result": true, eat_nonce: nonce })], { "GPU-0": jwt({ hwmodel: "GH100", measres: "success" }) }], nonce);
  assert.equal(ok.overall, true);
  assert.equal(ok.nonceMatch, true);
  assert.equal(ok.gpus[0].hwmodel, "GH100");
  const replayed = summarizeNras([["JWT", jwt({ "x-nvidia-overall-att-result": true, eat_nonce: "cd".repeat(32) })]], nonce);
  assert.equal(replayed.nonceMatch, false);
});
