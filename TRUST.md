# Trust model: what Sealed Evals proves, how to check it, and what it does not cover

Sealed Evals claims one thing: **a score labeled Sealed came from a model that answered the hidden
questions inside attested hardware, and the questions were never readable outside attested hardware.**
Below, each link in that claim, the code that enforces it, and how to check it yourself.

## 1. Only attested agent code can touch benchmarks or money

| Claim | Enforced by | Check it |
|---|---|---|
| The agent runs in an Intel TDX enclave on Phala with approved code | `register_agent` verifies the dstack attestation on chain (`agent-contract/src/lib.rs`, from the Shade template) | `get_agents` on the contract: `validity: "Valid"` and the compose hash |
| Only that agent can seal, claim, settle, refund or publish the seal key | `require_valid_agent()` at the top of every agent method in `agent-contract/src/sealed.rs` | Unit tests `only_agents_can_seal`, `strangers_cannot_submit`, `seal_key_is_agent_only_and_readable` |

## 2. The benchmark is only readable inside that code

| Claim | Enforced by | Check it |
|---|---|---|
| The seal key is derived in the TEE and never leaves it | `src/tee/keys.ts` (dstack `getKey`) | `GET /api/seal-key?nonce=<64 hex>` returns a fresh TDX quote; verify it at proof.t16z.com and check `report_data` |
| The browser encrypts to the key the attested agent published on chain, not to whatever the API says | `set_seal_key` (agent-only) and `frontend/src/pages/Seal.jsx` | `get_seal_key(<agent>)` on the contract |
| A ciphertext is bound to one benchmark on one contract | AES-GCM AAD `sealed-evals:v1:<contract>:<id>` in `src/shared/envelope.ts` | `test/shared.test.ts` "envelope is bound to its benchmark id" |
| The agent only accepts the exact file the author registered | sha256 of the decrypted plaintext must equal the on-chain `set_hash` (`src/routes/api.ts`) | e2e test "upload rejects a file whose hash differs from the chain" |
| Plaintext never touches disk | re-encrypted with a TEE storage key (`src/tee/store.ts`) | e2e test "author seals the benchmark" checks the file on disk |

## 3. Questions only go to models that prove they run in a TEE

| Claim | Enforced by | Check it |
|---|---|---|
| Fresh attestation per run, bound to our nonce | `attestModel` in `src/nearai/client.ts` requires the nonce echo | evidence `model_attestation.nonce` |
| NVIDIA confirms the GPU evidence for that nonce | NRAS called over TLS from inside the TEE; `eat_nonce` must match | raw NRAS response in evidence `model_attestation.nras_response` (verify the JWTs with NVIDIA's keys) |
| Every answer is signed by the attested model TEE | `checkSignature`; only `provider_tee` signatures from a listed `signing_address` count | the result page recomputes every signature in your browser |
| The first unverifiable answer stops the run | `runEval` stop flag, then `fail_eval` refunds | e2e test "an answer signed by an unattested key stops a sealed run" |
| Sealed requires 100% verified answers | `submit_result` panics otherwise | unit test `sealed_requires_every_answer_verified` |
| Unattested models only run if the author opted in, under the policy at payment time | `allow_leak_risk` snapshot on the eval | unit test `leak_policy_is_snapshotted_at_request_time`; e2e "unattested model is refused before any question is sent" |

## 4. The score and its evidence settle together

| Claim | Enforced by | Check it |
|---|---|---|
| Evidence hash and attestation report hash are stored with the score | `submit_result` | result page rows 1 and 2; press "Flip one character" to watch them fail |
| The author is paid exactly once | `take_pending_eval` guards every settlement path | unit tests `cannot_submit_twice`, `full_sealed_run_pays_author` |
| Requesters can always get their escrow back if the agent stalls | `reclaim_eval` after the timeout | unit tests `reclaim_after_timeout_refunds`, `claimed_runs_get_a_longer_window` |
| Evidence reveals no questions, answers or per-item correctness | `runEval` builds evidence from hashes and signatures only | e2e test asserts no prompt or answer text and no per-item `correct` |

## 5. Attestation is not a bug shield

On 8 Nov 2026 NEAR AI Cloud disclosed a vulnerability in its serving software; its
[incident report](https://near.ai/blog/security-incident-report-sglang-vulnerability) says requests in
confidential mode could have been observed, and that a TEE does not protect against a flaw in the
software running inside it. That applies to this agent's code too. What Sealed Evals does about it:

| Measure | Where |
|---|---|
| A fresh attestation and NVIDIA check for every run, never a cached one | `attestModel` is called inside `runEval` |
| The exact attestation report and raw NVIDIA response are kept, hashed and settled with the score, so a run can be re-judged later against known-bad measurements | `submit_result(model_attestation_hash)`, evidence `nras_response` |
| Authors can retire a benchmark at any time; retired sets stop accepting runs | `update_benchmark(active: false)` |
| A sealed set that passed through a compromised serving stack should be treated as exposed and rotated | author guidance; the leaderboard keeps each run's date |

## Reproduce

```bash
npm run judge                                       # everything below in one command
npm ci && npm test                                  # 22 agent tests, incl. end-to-end with mock NEAR AI + NVIDIA
cd agent-contract && cargo test --lib               # 78 contract tests
```

## Not covered (stated plainly)

* Hardware and vendor trust: Intel TDX, NVIDIA confidential computing, Phala's KMS.
* The contract owner approves measurements; a malicious approval could expose sealed sets.
* The seal key is tied to the Phala app id, so whoever controls that app is in the trust base.
* The agent does not yet independently verify the TDX quotes of NEAR AI's gateway and model nodes; it stores the report hash on chain.
* NRAS JWT signatures are verified by whoever downloads the evidence, not in the browser.
* Request hashes let someone confirm a question they can guess exactly, including formatting.
* Payouts to deleted accounts stay in the contract.
* Graders: exact, contains, number, multiple choice.
