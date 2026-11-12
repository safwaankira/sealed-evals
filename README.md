# Sealed Evals

**Hidden AI benchmarks, scored inside a TEE, paid per run on NEAR.**

**It attests the grader, not just the answers.** The code that holds the questions and does the
grading runs in an enclave the NEAR contract verified, so you don't have to trust whoever operates it.

**Who pays whom:** anyone who wants a score pays the benchmark author's price in NEAR per run. The
contract holds it in escrow and pays the author when the score settles, or refunds the requester.

| Status | What | Check |
|---|---|---|
| Works, tested | Contract: registry, escrow, agent-only settlement, strict Sealed rule, refunds | `cargo test --lib` (78 tests) |
| Works, tested | Agent: sealing, NEAR AI attestation + NVIDIA gate, per-answer signature checks, evidence | `npm test` (19 tests, end to end against mocks) |
| Works | Web app: leaderboard, seal, pay-to-run, in-browser re-verification, tamper button | no wallet needed to view or verify |
| Pending | Live Shade Agent on Phala + testnet contract, with real runs | links added here once deployed |

One command for all of it: `npm run judge`.

Benchmarks stop meaning anything once their questions leak into training data. Sealed Evals keeps the
questions inside attested hardware for their whole life:

1. **Seal.** An author encrypts a benchmark in the browser to a key that only exists inside a
   [Shade Agent](https://docs.near.org/ai/shade-agents/getting-started/introduction) TEE on Phala Cloud.
   The NEAR contract stores only its sha256 and a price per run.
2. **Run.** Anyone escrows the price to score a model. Before a single question leaves, the agent asks
   NEAR AI Cloud for an attestation with a fresh nonce, checks the GPU evidence with NVIDIA, and later
   requires every answer to be signed by a key from that report.
3. **Prove.** Grading happens inside the TEE. The agent publishes an evidence file (hashes and
   signatures, never questions or answers), settles the score and the evidence hash on chain, and the
   contract pays the author. Any result page re-checks all of it in the browser.

Runs are labeled honestly:

| Label | When | Questions seen by |
|---|---|---|
| **Sealed** | Model served from a NEAR AI Cloud TEE, attestation and NVIDIA check passed | attested enclaves only |
| **Leak risk** | Closed API model, or attestation failed | the provider. Only runs if the author opted in; otherwise refused and refunded before anything is sent |

Tracks: **Privacy & Private AI** (primary: TEE, NEAR AI Cloud) and **Agent Economy** (pay per run for data).

## Chain of trust

```
author browser ──encrypt (X25519+HKDF+AES-GCM, AAD = contract:benchmark)──▶ Shade Agent TEE (Phala, Intel TDX)
                                                                              │  seal key from dstack KMS,
NEAR contract ◀── register_agent(TDX attestation, verified on chain) ─────────┤  TDX quote commits to it
     ▲                                                                        │
     │ submit_result(score, evidence_hash)                                    ▼
     └──────────────── grade inside TEE ◀── answers + signatures ── NEAR AI Cloud TEE (attested, NVIDIA NRAS)
```

* Only agents whose TDX measurements the owner approved can `seal_benchmark`, `claim_eval`, `submit_result`, `fail_eval` or `set_seal_key`.
* The agent publishes its seal key on chain with `set_seal_key`; the web app encrypts to that copy, not to whatever the API returns.
* A run is **Sealed** only if every answer carries a verified signature from the attested model TEE (enforced by the contract). The first unverifiable answer stops the run and refunds it.
* The author's leak-risk policy is snapshotted when a run is paid for. Evidence is only served once a run settles, and holds no per-item correctness.
* `GET /api/seal-key?nonce=<32 bytes hex>` returns a fresh quote with `report_data = sha256(sha256("sealed-evals:seal-key:v1:<pk>") ":" nonce)`.
* Requesters can `reclaim_eval` their escrow if the agent doesn't answer within an hour (longer once the agent has claimed the run, scaled by item count).
* Operator limits (env): `MAX_RUN_ITEMS` (default 500) and `MIN_PRICE_PER_ITEM_YOCTO` (default 0.001 NEAR), because the operator's NEAR AI key pays for inference.

Full claim by claim breakdown with the code and tests behind each: **[TRUST.md](TRUST.md)**.
Every result page re-checks the run in the browser, and a "Flip one character" button shows the checks catching a tampered evidence file.

### Known limits

* Trust in Intel TDX, NVIDIA confidential computing and Phala's KMS.
* The contract owner approves code measurements; approving malicious code could expose sealed sets.
* The seal key comes from Phala's KMS for this app id, so the app id and its compose hash are part of the trust base.
* NRAS JWTs are stored raw in the evidence but checked against NVIDIA's keys only by whoever downloads them.
* Request hashes in the evidence act as a membership check for anyone who can guess a question exactly.
* Payouts to deleted accounts stay in the contract.
* The agent verifies NVIDIA GPU attestation and every answer signature, but does not yet independently
  verify the TDX quotes of NEAR AI's gateway and model nodes (their report hash is stored on chain).
* Graders: exact, contains, number, multiple choice.
* Testnet only.

## Layout

| Path | What |
|---|---|
| `agent-contract/src/sealed.rs` | Benchmarks registry, escrow, agent-only settlement, refunds (unit tests in `internal/sealed_tests.rs`) |
| `src/tee/` | Seal key + quote (dstack), encrypted at-rest storage |
| `src/nearai/client.ts` | NEAR AI Cloud attestation, NVIDIA NRAS check, chat + signature verification |
| `src/eval/` | Work queue and eval runner |
| `src/shared/` | Envelope crypto and graders, shared by the agent and the web app |
| `frontend/` | Web app, built into the same attested image |
| `test/` | Crypto/grader tests and an end-to-end run against mock NEAR AI + NVIDIA services |

## Run it

```bash
npm i && npm test                       # agent tests
cd agent-contract && cargo test --lib   # contract tests
```

Deploy follows the Shade Agent flow: fill `.env` (see `.env.example`, including `NEARAI_CLOUD_API_KEY`) and
`deployment.yaml`, then `shade deploy` with `environment: TEE`.

## Review

Before deploy, an independent model reviewed the contract, agent and web app. All High findings and the important Medium/Low ones are fixed; the remaining ones are listed above as known limits.

## Built on

Open source code reused under its license, as the hackathon rules allow:

* [NearDeFi/shade-agent-template](https://github.com/NearDeFi/shade-agent-template) (Apache-2.0): contract, attestation verification, agent bootstrap, Docker and deploy config.
* [near-examples/nearai-cloud-verification-example](https://github.com/near-examples/nearai-cloud-verification-example) (MIT): attestation, NVIDIA and signature verification logic, ported to TypeScript in `src/nearai/client.ts`.
* Prior art credited: Ritual's Evault proposal and ManaTEE described TEE-verified evals; Sealed Evals is a working NEAR-native implementation with per-run payments and leak labels.

## Related work in this hackathon

Closest entries, all worth a look: [BlindBench](https://github.com/yfarmxdev/blindbench) (private evals
that pay authors), [PROCTOR](https://github.com/egbujor-emmanuel/proctor) (sealed exams for agents on
OutLayer) and [Laurel](https://github.com/agadape/laurel) (small models scored on a private test set).
Sealed Evals differs in three enforced rules: the grader itself runs in an enclave the contract attested,
a failed NVIDIA check blocks scoring instead of being recorded, and a run is only Sealed if every answer
is signed by the attested model.

Other entries seal different things, and Sealed Evals borrows ideas from their presentation:
[TEE Receipts](https://github.com/tmdry4530/tee-receipts) records NEAR AI Cloud signatures on chain,
[Judge on NEAR](https://github.com/vijaygopalbalasa/judge-near) grades sealed agent work in a TEE,
[PatchBond](https://github.com/PatchBond/patchbond) judges pull requests in a TEE with a verify checklist, and
[Proof of Done](https://github.com/team-attention/proof-of-done) uses hidden tests without a TEE.
Sealed Evals is the one that seals the benchmark questions themselves and pays their author per run.

Code written with AI assistance (Claude), as permitted by the rules.

License: Apache-2.0.
