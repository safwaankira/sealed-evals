//! Sealed Evals: a registry of sealed benchmarks and an escrow for paid eval runs.
//!
//! Flow
//! 1. An author calls `register_benchmark` with the sha256 of the plaintext benchmark file,
//!    a price per run and whether they allow "leak risk" runs against closed-API models.
//! 2. The author encrypts the benchmark to the agent's TEE seal key and uploads it to the agent.
//!    The agent (running in an attested TEE) decrypts it, checks the hash matches and calls
//!    `seal_benchmark`. From then on the plaintext only exists inside the TEE.
//! 3. Anyone calls `request_eval` and escrows the price.
//! 4. The agent runs the benchmark against the model and calls `submit_result`, which pays the
//!    author, or `fail_eval`, which refunds the requester. If the agent never answers, the
//!    requester can `reclaim_eval` after `EVAL_TIMEOUT_MS`.
//!
//! Only agents that registered with a valid TEE attestation (see `register_agent`) can seal,
//! submit or fail. The contract never sees benchmark questions or answers.

use crate::*;
use near_sdk::{PromiseOrValue, store::Vector};

/// Requesters can reclaim escrow if the agent hasn't answered within this window.
pub const EVAL_TIMEOUT_MS: u64 = 60 * 60 * 1000; // 1 hour
/// Once the agent has claimed a run, the window grows with the benchmark size.
pub const RUN_MS_PER_ITEM: u64 = 15_000;
/// Storage the settled result (or failure reason) will add later, paid up front by the requester.
pub const RESULT_RESERVE_BYTES: u128 = 600;

const MAX_NAME_LEN: usize = 64;
const MAX_DESCRIPTION_LEN: usize = 500;
const MAX_MODEL_LEN: usize = 128;
const MAX_REASON_LEN: usize = 200;
const MAX_ITEMS: u32 = 2_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RunMode {
    /// Model ran inside an attested NEAR AI Cloud TEE; questions never left attested hardware.
    Sealed,
    /// Model is a third-party API outside any TEE; the provider saw the questions.
    LeakRisk,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EvalStatus {
    Pending,
    Completed,
    Failed,
    Refunded,
}

#[near(serializers = [borsh])]
pub struct Benchmark {
    pub author: AccountId,
    pub name: String,
    pub description: String,
    /// sha256 (lowercase hex) of the exact plaintext benchmark bytes the author encrypted
    pub set_hash: String,
    pub price: NearToken,
    pub allow_leak_risk: bool,
    pub active: bool,
    pub item_count: u32,
    pub sealed_by: Option<AccountId>,
    pub sealed_at_ms: Option<u64>,
    pub created_ms: u64,
    pub runs: u32,
    pub earned: NearToken,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct EvalResult {
    pub mode: RunMode,
    pub correct: u32,
    pub total: u32,
    /// correct / total in basis points (10000 = 100%)
    pub score_bps: u32,
    /// how many model responses carried a valid TEE signature
    pub verified_responses: u32,
    /// sha256 of the evidence JSON the agent publishes (hashes and signatures only, no questions)
    pub evidence_hash: String,
    /// sha256 of the NEAR AI Cloud attestation report the run was checked against
    pub model_attestation_hash: String,
    pub agent: AccountId,
    pub completed_ms: u64,
}

#[near(serializers = [borsh])]
pub struct Eval {
    pub requester: AccountId,
    pub benchmark_id: u64,
    pub model: String,
    pub paid: NearToken,
    pub status: EvalStatus,
    pub created_ms: u64,
    /// Author's leak-risk policy at request time, so it can't be flipped mid-run
    pub allow_leak_risk: bool,
    /// Set when the agent starts the run; extends the reclaim window
    pub claimed_ms: Option<u64>,
    pub result: Option<EvalResult>,
    pub failure_reason: Option<String>,
}

#[near(serializers = [json])]
pub struct BenchmarkView {
    pub id: U64,
    pub author: AccountId,
    pub name: String,
    pub description: String,
    pub set_hash: String,
    pub price: NearToken,
    pub allow_leak_risk: bool,
    pub active: bool,
    pub item_count: u32,
    pub sealed: bool,
    pub sealed_by: Option<AccountId>,
    pub sealed_at_ms: Option<U64>,
    pub created_ms: U64,
    pub runs: u32,
    pub earned: NearToken,
}

#[near(serializers = [json])]
pub struct EvalView {
    pub id: U64,
    pub requester: AccountId,
    pub benchmark_id: U64,
    pub model: String,
    pub paid: NearToken,
    pub status: EvalStatus,
    pub created_ms: U64,
    pub allow_leak_risk: bool,
    pub claimed_ms: Option<U64>,
    pub result: Option<EvalResult>,
    pub failure_reason: Option<String>,
}

pub(crate) fn benchmark_view(id: u64, b: &Benchmark) -> BenchmarkView {
    BenchmarkView {
        id: U64(id),
        author: b.author.clone(),
        name: b.name.clone(),
        description: b.description.clone(),
        set_hash: b.set_hash.clone(),
        price: b.price,
        allow_leak_risk: b.allow_leak_risk,
        active: b.active,
        item_count: b.item_count,
        sealed: b.sealed_by.is_some(),
        sealed_by: b.sealed_by.clone(),
        sealed_at_ms: b.sealed_at_ms.map(U64),
        created_ms: U64(b.created_ms),
        runs: b.runs,
        earned: b.earned,
    }
}

pub(crate) fn eval_view(id: u64, e: &Eval) -> EvalView {
    EvalView {
        id: U64(id),
        requester: e.requester.clone(),
        benchmark_id: U64(e.benchmark_id),
        model: e.model.clone(),
        paid: e.paid,
        status: e.status.clone(),
        created_ms: U64(e.created_ms),
        allow_leak_risk: e.allow_leak_risk,
        claimed_ms: e.claimed_ms.map(U64),
        result: e.result.clone(),
        failure_reason: e.failure_reason.clone(),
    }
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn is_valid_model_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_MODEL_LEN
        && s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_./:@".contains(&b))
}

impl Contract {
    /// Charges the predecessor for the storage added since `initial_usage`, on top of
    /// `reserved` (the part of the deposit meant for something else, e.g. escrow), and
    /// refunds whatever is left over.
    pub(crate) fn settle_storage_deposit(&self, initial_usage: u64, reserved: NearToken) {
        let used = env::storage_usage().saturating_sub(initial_usage);
        let storage_cost = env::storage_byte_cost()
            .checked_mul(used as u128)
            .expect("storage cost overflow");
        let required = reserved
            .checked_add(storage_cost)
            .expect("required deposit overflow");
        let deposit = env::attached_deposit();
        require!(
            deposit >= required,
            &format!(
                "Attached deposit {} is less than the required {} (price + storage)",
                deposit.exact_amount_display(),
                required.exact_amount_display()
            )
        );
        let refund = deposit.saturating_sub(required);
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id()).transfer(refund).detach();
        }
    }

    /// `store` collections only write to storage when flushed, so flush before measuring
    /// storage usage; otherwise the storage delta reads as zero and nobody pays for it.
    fn flush_sealed(&mut self) {
        self.benchmarks.flush();
        self.evals.flush();
        self.pending_evals.flush();
        self.benchmark_evals.flush();
    }

    fn benchmark_mut(&mut self, id: u64) -> &mut Benchmark {
        self.benchmarks.get_mut(&id).expect("Benchmark not found")
    }

    fn take_pending_eval(&mut self, eval_id: u64) -> &mut Eval {
        let eval = self.evals.get_mut(&eval_id).expect("Eval not found");
        require!(eval.status == EvalStatus::Pending, "Eval is not pending");
        eval
    }
}

#[near]
impl Contract {
    // ---------- Authors ----------

    /// Register a benchmark. `set_hash` is the sha256 of the plaintext file you will seal.
    /// Attach enough NEAR to cover storage (~0.01 NEAR); the excess is refunded.
    #[payable]
    pub fn register_benchmark(
        &mut self,
        name: String,
        description: String,
        set_hash: String,
        price: NearToken,
        allow_leak_risk: bool,
    ) -> U64 {
        let initial = env::storage_usage();
        require!(
            !name.trim().is_empty() && name.len() <= MAX_NAME_LEN,
            "Name must be 1-64 bytes"
        );
        require!(
            description.len() <= MAX_DESCRIPTION_LEN,
            "Description must be at most 500 bytes"
        );
        require!(
            is_sha256_hex(&set_hash),
            "set_hash must be 64 lowercase hex characters"
        );

        let id = self.next_benchmark_id;
        self.next_benchmark_id += 1;
        let author = env::predecessor_account_id();
        self.benchmarks.insert(
            id,
            Benchmark {
                author: author.clone(),
                name,
                description,
                set_hash: set_hash.clone(),
                price,
                allow_leak_risk,
                active: true,
                item_count: 0,
                sealed_by: None,
                sealed_at_ms: None,
                created_ms: block_timestamp_ms(),
                runs: 0,
                earned: NearToken::from_yoctonear(0),
            },
        );
        self.benchmark_evals
            .insert(id, Vector::new(StorageKey::BenchmarkEvals { benchmark_id: id }));

        log!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "sealed-evals", "version": "1.0.0", "event": "benchmark_registered",
                "data": [{ "benchmark_id": U64(id), "author": author, "set_hash": set_hash }]
            })
        );

        self.flush_sealed();
        self.settle_storage_deposit(initial, NearToken::from_yoctonear(0));
        U64(id)
    }

    /// Author-only: change price, leak-risk policy or retire the benchmark.
    pub fn update_benchmark(
        &mut self,
        benchmark_id: U64,
        price: Option<NearToken>,
        allow_leak_risk: Option<bool>,
        active: Option<bool>,
    ) {
        let caller = env::predecessor_account_id();
        let benchmark = self.benchmark_mut(benchmark_id.0);
        require!(benchmark.author == caller, "Only the author can update");
        if let Some(p) = price {
            benchmark.price = p;
        }
        if let Some(a) = allow_leak_risk {
            benchmark.allow_leak_risk = a;
        }
        if let Some(a) = active {
            benchmark.active = a;
        }
    }

    // ---------- Requesters ----------

    /// Pay to run a sealed benchmark against a model. Attach the price plus a little for
    /// storage (~0.01 NEAR); the excess is refunded.
    #[payable]
    pub fn request_eval(&mut self, benchmark_id: U64, model: String) -> U64 {
        let initial = env::storage_usage();
        require!(
            is_valid_model_id(&model),
            "Model id must be 1-128 chars of [A-Za-z0-9-_./:@]"
        );
        let benchmark = self
            .benchmarks
            .get(&benchmark_id.0)
            .expect("Benchmark not found");
        require!(benchmark.active, "Benchmark is retired");
        require!(benchmark.sealed_by.is_some(), "Benchmark is not sealed yet");
        let price = benchmark.price;
        let allow_leak_risk = benchmark.allow_leak_risk;

        let id = self.next_eval_id;
        self.next_eval_id += 1;
        let requester = env::predecessor_account_id();
        self.evals.insert(
            id,
            Eval {
                requester: requester.clone(),
                benchmark_id: benchmark_id.0,
                model: model.clone(),
                paid: price,
                status: EvalStatus::Pending,
                created_ms: block_timestamp_ms(),
                allow_leak_risk,
                claimed_ms: None,
                result: None,
                failure_reason: None,
            },
        );
        self.pending_evals.insert(id);
        {
            let index = self
                .benchmark_evals
                .get_mut(&benchmark_id.0)
                .expect("Benchmark eval index missing");
            index.push(id);
            index.flush();
        }

        log!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "sealed-evals", "version": "1.0.0", "event": "eval_requested",
                "data": [{ "eval_id": U64(id), "benchmark_id": benchmark_id, "model": model, "requester": requester }]
            })
        );

        self.flush_sealed();
        let result_reserve = env::storage_byte_cost()
            .checked_mul(RESULT_RESERVE_BYTES)
            .expect("reserve overflow");
        self.settle_storage_deposit(initial, price.checked_add(result_reserve).expect("overflow"));
        U64(id)
    }

    /// Requester-only: get the escrow back if the agent hasn't answered in time.
    pub fn reclaim_eval(&mut self, eval_id: U64) -> Promise {
        let caller = env::predecessor_account_id();
        let now = block_timestamp_ms();
        let item_count = {
            let e = self.evals.get(&eval_id.0).expect("Eval not found");
            self.benchmarks.get(&e.benchmark_id).map(|b| b.item_count).unwrap_or(0)
        };
        let eval = self.take_pending_eval(eval_id.0);
        require!(eval.requester == caller, "Only the requester can reclaim");
        let deadline = match eval.claimed_ms {
            Some(claimed) => claimed
                .saturating_add(EVAL_TIMEOUT_MS)
                .saturating_add(RUN_MS_PER_ITEM.saturating_mul(item_count as u64)),
            None => eval.created_ms.saturating_add(EVAL_TIMEOUT_MS),
        };
        require!(now >= deadline, "Eval has not timed out yet");
        eval.status = EvalStatus::Refunded;
        eval.failure_reason = Some("Timed out, reclaimed by requester".to_string());
        let paid = eval.paid;
        self.pending_evals.remove(&eval_id.0);
        Promise::new(caller).transfer(paid)
    }

    // ---------- Agent (attested TEE only) ----------

    /// Agent-only: record that the TEE holds the benchmark whose plaintext hashes to `set_hash`.
    /// Can be called again if the agent is redeployed and the author re-uploads.
    pub fn seal_benchmark(&mut self, benchmark_id: U64, item_count: u32) -> PromiseOrValue<bool> {
        if let Some(failure) = self.require_valid_agent() {
            return PromiseOrValue::Promise(failure);
        }
        require!(
            item_count > 0 && item_count <= MAX_ITEMS,
            "item_count must be 1-10000"
        );
        let agent = env::predecessor_account_id();
        let benchmark = self.benchmark_mut(benchmark_id.0);
        require!(
            benchmark.item_count == 0 || benchmark.item_count == item_count,
            "item_count does not match the sealed set"
        );
        benchmark.item_count = item_count;
        benchmark.sealed_by = Some(agent.clone());
        benchmark.sealed_at_ms = Some(block_timestamp_ms());
        log!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "sealed-evals", "version": "1.0.0", "event": "benchmark_sealed",
                "data": [{ "benchmark_id": benchmark_id, "agent": agent, "item_count": item_count }]
            })
        );
        PromiseOrValue::Value(true)
    }

    /// Agent-only: mark a run as started so the requester can't reclaim mid-run.
    pub fn claim_eval(&mut self, eval_id: U64) -> PromiseOrValue<bool> {
        if let Some(failure) = self.require_valid_agent() {
            return PromiseOrValue::Promise(failure);
        }
        let now = block_timestamp_ms();
        let eval = self.take_pending_eval(eval_id.0);
        if eval.claimed_ms.is_none() {
            eval.claimed_ms = Some(now);
        }
        PromiseOrValue::Value(true)
    }

    /// Agent-only: publish the X25519 key authors encrypt to. Because only attested code can call
    /// this, the web app reads the key from here instead of trusting whoever serves the page.
    pub fn set_seal_key(&mut self, public_key: String) -> PromiseOrValue<bool> {
        if let Some(failure) = self.require_valid_agent() {
            return PromiseOrValue::Promise(failure);
        }
        require!(is_sha256_hex(&public_key), "public_key must be 32 bytes of lowercase hex");
        self.seal_keys.insert(env::predecessor_account_id(), public_key);
        PromiseOrValue::Value(true)
    }

    /// Agent-only: publish the score and pay the benchmark author.
    #[allow(clippy::too_many_arguments)]
    pub fn submit_result(
        &mut self,
        eval_id: U64,
        mode: RunMode,
        correct: u32,
        total: u32,
        verified_responses: u32,
        evidence_hash: String,
        model_attestation_hash: String,
    ) -> PromiseOrValue<bool> {
        if let Some(failure) = self.require_valid_agent() {
            return PromiseOrValue::Promise(failure);
        }
        require!(is_sha256_hex(&evidence_hash), "evidence_hash must be sha256 hex");
        require!(
            is_sha256_hex(&model_attestation_hash),
            "model_attestation_hash must be sha256 hex"
        );
        let agent = env::predecessor_account_id();
        let now = block_timestamp_ms();

        let (benchmark_id, paid, allow_leak_risk) = {
            let eval = self.take_pending_eval(eval_id.0);
            (eval.benchmark_id, eval.paid, eval.allow_leak_risk)
        };
        let (author, item_count) = {
            let b = self.benchmarks.get(&benchmark_id).expect("Benchmark not found");
            (b.author.clone(), b.item_count)
        };
        require!(total == item_count, "total must equal the sealed item count");
        require!(correct <= total, "correct cannot exceed total");
        require!(verified_responses <= total, "verified_responses cannot exceed total");
        if mode == RunMode::LeakRisk {
            require!(allow_leak_risk, "Author does not allow leak-risk runs");
        } else {
            require!(
                verified_responses == total,
                "A sealed run needs a verified TEE signature on every answer"
            );
        }
        let score_bps = ((correct as u64) * 10_000 / (total as u64)) as u32;

        // Effects before the transfer
        {
            let eval = self.evals.get_mut(&eval_id.0).expect("Eval not found");
            eval.status = EvalStatus::Completed;
            eval.result = Some(EvalResult {
                mode: mode.clone(),
                correct,
                total,
                score_bps,
                verified_responses,
                evidence_hash: evidence_hash.clone(),
                model_attestation_hash,
                agent: agent.clone(),
                completed_ms: now,
            });
        }
        self.pending_evals.remove(&eval_id.0);
        {
            let b = self.benchmark_mut(benchmark_id);
            b.runs += 1;
            b.earned = b.earned.saturating_add(paid);
        }

        log!(
            "EVENT_JSON:{}",
            serde_json::json!({
                "standard": "sealed-evals", "version": "1.0.0", "event": "eval_completed",
                "data": [{ "eval_id": eval_id, "benchmark_id": U64(benchmark_id), "mode": mode,
                           "score_bps": score_bps, "evidence_hash": evidence_hash }]
            })
        );

        if paid.is_zero() {
            PromiseOrValue::Value(true)
        } else {
            PromiseOrValue::Promise(Promise::new(author).transfer(paid))
        }
    }

    /// Agent-only: the run could not happen (model unavailable, policy blocked it, ...).
    /// Refunds the requester in full.
    pub fn fail_eval(&mut self, eval_id: U64, reason: String) -> PromiseOrValue<bool> {
        if let Some(failure) = self.require_valid_agent() {
            return PromiseOrValue::Promise(failure);
        }
        let reason: String = reason.chars().take(MAX_REASON_LEN).collect();
        let eval = self.take_pending_eval(eval_id.0);
        eval.status = EvalStatus::Failed;
        eval.failure_reason = Some(reason);
        let paid = eval.paid;
        let requester = eval.requester.clone();
        self.pending_evals.remove(&eval_id.0);
        if paid.is_zero() {
            PromiseOrValue::Value(true)
        } else {
            PromiseOrValue::Promise(Promise::new(requester).transfer(paid))
        }
    }

    // ---------- Views ----------

    pub fn get_seal_key(&self, account_id: AccountId) -> Option<String> {
        self.seal_keys.get(&account_id).cloned()
    }

    pub fn get_benchmark(&self, benchmark_id: U64) -> Option<BenchmarkView> {
        self.benchmarks
            .get(&benchmark_id.0)
            .map(|b| benchmark_view(benchmark_id.0, b))
    }

    pub fn get_benchmarks(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<BenchmarkView> {
        self.benchmarks
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .map(|(id, b)| benchmark_view(*id, b))
            .collect()
    }

    pub fn get_eval(&self, eval_id: U64) -> Option<EvalView> {
        self.evals.get(&eval_id.0).map(|e| eval_view(eval_id.0, e))
    }

    /// Newest first.
    pub fn get_evals(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<EvalView> {
        let total = self.next_eval_id;
        let from = from_index.unwrap_or(0) as u64;
        let limit = limit.unwrap_or(50).min(100) as u64;
        (0..total)
            .rev()
            .skip(from as usize)
            .take(limit as usize)
            .filter_map(|id| self.evals.get(&id).map(|e| eval_view(id, e)))
            .collect()
    }

    pub fn get_benchmark_evals(
        &self,
        benchmark_id: U64,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<EvalView> {
        let Some(ids) = self.benchmark_evals.get(&benchmark_id.0) else {
            return vec![];
        };
        ids.iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .filter_map(|id| self.evals.get(id).map(|e| eval_view(*id, e)))
            .collect()
    }

    /// Pending evals for the agent's work queue (paged; the agent pages through all of them).
    pub fn get_pending_evals(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<EvalView> {
        self.pending_evals
            .iter()
            .copied()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(20).min(100) as usize)
            .filter_map(|id| self.evals.get(&id).map(|e| eval_view(id, e)))
            .collect()
    }
}
