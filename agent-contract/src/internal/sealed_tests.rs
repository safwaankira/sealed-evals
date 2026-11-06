use crate::*;
use near_sdk::test_utils::{VMContextBuilder, accounts, get_created_receipts};
use near_sdk::{NearToken, PromiseOrValue, testing_env};
use shade_attestation::{
    attestation::create_mock_dstack_attestation, measurements::create_mock_full_measurements_hex,
    tcb_info::HexBytes,
};

const ONE_NEAR: NearToken = NearToken::from_near(1);
const STORAGE: NearToken = NearToken::from_millinear(50); // 0.05 NEAR covers storage in tests
const HASH: &str = "aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11";
const EVID: &str = "bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22bb22";

fn ctx(predecessor: AccountId, deposit: NearToken, ts_ms: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("sealed.testnet".parse().unwrap())
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .attached_deposit(deposit)
        .account_balance(NearToken::from_near(100))
        .block_timestamp(ts_ms * 1_000_000);
    testing_env!(b.build());
}

fn owner() -> AccountId {
    accounts(0)
}
fn author() -> AccountId {
    accounts(1)
}
fn requester() -> AccountId {
    accounts(2)
}
fn agent() -> AccountId {
    accounts(3)
}
fn stranger() -> AccountId {
    accounts(4)
}

/// Contract in local mode with `agent()` whitelisted and registered.
fn setup() -> Contract {
    ctx(owner(), NearToken::from_yoctonear(0), 1_000);
    let mut c = Contract::new(
        false,
        U64(7 * 24 * 60 * 60 * 1000),
        owner(),
        "v1.signer-prod.testnet".parse().unwrap(),
    );
    c.approve_measurements(create_mock_full_measurements_hex());
    c.approve_ppids(vec![HexBytes::from([0u8; 16])]);
    c.whitelist_agent_for_local(agent());
    ctx(agent(), NearToken::from_millinear(10), 1_000);
    assert!(c.register_agent(create_mock_dstack_attestation()));
    c
}

fn registered_and_sealed(c: &mut Contract, price: NearToken, allow_leak: bool) -> U64 {
    ctx(author(), STORAGE, 2_000);
    let id = c.register_benchmark(
        "Sealed Math".into(),
        "Ten hidden arithmetic word problems".into(),
        HASH.into(),
        price,
        allow_leak,
    );
    ctx(agent(), NearToken::from_yoctonear(0), 3_000);
    assert!(matches!(c.seal_benchmark(id, 10), PromiseOrValue::Value(true)));
    id
}

fn transfers() -> Vec<(String, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                near_sdk::mock::MockAction::Transfer { deposit, .. } => {
                    Some((to.clone(), deposit.as_yoctonear()))
                }
                _ => None,
            })
        })
        .collect()
}

#[test]
fn register_benchmark_stores_it_unsealed() {
    let mut c = setup();
    ctx(author(), STORAGE, 2_000);
    let id = c.register_benchmark("B".into(), "".into(), HASH.into(), ONE_NEAR, false);
    let b = c.get_benchmark(id).unwrap();
    assert_eq!(b.author, author());
    assert_eq!(b.set_hash, HASH);
    assert!(!b.sealed);
    assert_eq!(b.item_count, 0);
}

#[test]
fn register_refunds_excess_deposit() {
    let mut c = setup();
    ctx(author(), ONE_NEAR, 2_000);
    c.register_benchmark("B".into(), "".into(), HASH.into(), ONE_NEAR, false);
    let refunds = transfers();
    let (to, amt) = refunds.first().expect("expected a refund");
    assert_eq!(to, author().as_str());
    assert!(*amt > 0 && *amt < ONE_NEAR.as_yoctonear(), "storage must be charged");
}

#[test]
#[should_panic(expected = "set_hash must be 64 lowercase hex characters")]
fn register_rejects_bad_hash() {
    let mut c = setup();
    ctx(author(), STORAGE, 2_000);
    c.register_benchmark("B".into(), "".into(), "XYZ".into(), ONE_NEAR, false);
}

#[test]
#[should_panic(expected = "is less than the required")]
fn register_requires_storage_deposit() {
    let mut c = setup();
    ctx(author(), NearToken::from_yoctonear(0), 2_000);
    c.register_benchmark("B".into(), "".into(), HASH.into(), ONE_NEAR, false);
}

#[test]
#[should_panic(expected = "Agent not registered")]
fn only_agents_can_seal() {
    let mut c = setup();
    ctx(author(), STORAGE, 2_000);
    let id = c.register_benchmark("B".into(), "".into(), HASH.into(), ONE_NEAR, false);
    ctx(stranger(), NearToken::from_yoctonear(0), 3_000);
    let _ = c.seal_benchmark(id, 10);
}

#[test]
#[should_panic(expected = "Benchmark is not sealed yet")]
fn cannot_request_unsealed() {
    let mut c = setup();
    ctx(author(), STORAGE, 2_000);
    let id = c.register_benchmark("B".into(), "".into(), HASH.into(), ONE_NEAR, false);
    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 3_000);
    c.request_eval(id, "Qwen/Qwen3-30B".into());
}

#[test]
#[should_panic(expected = "is less than the required")]
fn request_requires_price() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(requester(), STORAGE, 4_000);
    c.request_eval(id, "Qwen/Qwen3-30B".into());
}

#[test]
#[should_panic(expected = "Model id must be")]
fn request_rejects_bad_model_id() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 4_000);
    c.request_eval(id, "bad model id with spaces".into());
}

#[test]
fn full_sealed_run_pays_author() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);

    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 4_000);
    let eval_id = c.request_eval(id, "Qwen/Qwen3-30B".into());
    assert_eq!(c.get_pending_evals(None).len(), 1);

    ctx(agent(), NearToken::from_yoctonear(0), 5_000);
    let out = c.submit_result(eval_id, RunMode::Sealed, 7, 10, 10, EVID.into(), HASH.into());
    assert!(matches!(out, PromiseOrValue::Promise(_)));
    drop(out); // promises are scheduled when dropped
    assert!(
        transfers()
            .iter()
            .any(|(to, amt)| to == author().as_str() && *amt == ONE_NEAR.as_yoctonear()),
        "author should receive the price"
    );

    let e = c.get_eval(eval_id).unwrap();
    assert_eq!(e.status, EvalStatus::Completed);
    let r = e.result.unwrap();
    assert_eq!(r.score_bps, 7_000);
    assert_eq!(r.mode, RunMode::Sealed);
    assert!(c.get_pending_evals(None).is_empty());
    let b = c.get_benchmark(id).unwrap();
    assert_eq!(b.runs, 1);
    assert_eq!(b.earned, ONE_NEAR);
    assert_eq!(c.get_benchmark_evals(id, None, None).len(), 1);
}

#[test]
#[should_panic(expected = "Author does not allow leak-risk runs")]
fn leak_risk_blocked_unless_author_allows() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 4_000);
    let eval_id = c.request_eval(id, "anthropic/claude".into());
    ctx(agent(), NearToken::from_yoctonear(0), 5_000);
    let _ = c.submit_result(eval_id, RunMode::LeakRisk, 5, 10, 0, EVID.into(), HASH.into());
}

#[test]
fn leak_risk_allowed_when_author_opts_in() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, true);
    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 4_000);
    let eval_id = c.request_eval(id, "anthropic/claude".into());
    ctx(agent(), NearToken::from_yoctonear(0), 5_000);
    let _ = c.submit_result(eval_id, RunMode::LeakRisk, 5, 10, 0, EVID.into(), HASH.into());
    assert_eq!(c.get_eval(eval_id).unwrap().result.unwrap().mode, RunMode::LeakRisk);
}

#[test]
#[should_panic(expected = "total must equal the sealed item count")]
fn total_must_match_sealed_count() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 4_000);
    let eval_id = c.request_eval(id, "Qwen/Qwen3-30B".into());
    ctx(agent(), NearToken::from_yoctonear(0), 5_000);
    let _ = c.submit_result(eval_id, RunMode::Sealed, 3, 3, 3, EVID.into(), HASH.into());
}

#[test]
#[should_panic(expected = "Agent not registered")]
fn strangers_cannot_submit() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 4_000);
    let eval_id = c.request_eval(id, "Qwen/Qwen3-30B".into());
    ctx(requester(), NearToken::from_yoctonear(0), 5_000);
    let _ = c.submit_result(eval_id, RunMode::Sealed, 10, 10, 10, EVID.into(), HASH.into());
}

#[test]
#[should_panic(expected = "Eval is not pending")]
fn cannot_submit_twice() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 4_000);
    let eval_id = c.request_eval(id, "Qwen/Qwen3-30B".into());
    ctx(agent(), NearToken::from_yoctonear(0), 5_000);
    let _ = c.submit_result(eval_id, RunMode::Sealed, 7, 10, 10, EVID.into(), HASH.into());
    let _ = c.submit_result(eval_id, RunMode::Sealed, 10, 10, 10, EVID.into(), HASH.into());
}

#[test]
fn fail_eval_refunds_requester() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 4_000);
    let eval_id = c.request_eval(id, "Qwen/Qwen3-30B".into());
    ctx(agent(), NearToken::from_yoctonear(0), 5_000);
    let _ = c.fail_eval(eval_id, "Model not served".into());
    assert!(
        transfers()
            .iter()
            .any(|(to, amt)| to == requester().as_str() && *amt == ONE_NEAR.as_yoctonear())
    );
    let e = c.get_eval(eval_id).unwrap();
    assert_eq!(e.status, EvalStatus::Failed);
    assert!(c.get_pending_evals(None).is_empty());
}

#[test]
#[should_panic(expected = "Eval has not timed out yet")]
fn reclaim_waits_for_timeout() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 4_000);
    let eval_id = c.request_eval(id, "Qwen/Qwen3-30B".into());
    ctx(requester(), NearToken::from_yoctonear(0), 5_000);
    drop(c.reclaim_eval(eval_id));
}

#[test]
fn reclaim_after_timeout_refunds() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 4_000);
    let eval_id = c.request_eval(id, "Qwen/Qwen3-30B".into());
    ctx(requester(), NearToken::from_yoctonear(0), 4_000 + sealed::EVAL_TIMEOUT_MS);
    drop(c.reclaim_eval(eval_id));
    assert!(
        transfers()
            .iter()
            .any(|(to, amt)| to == requester().as_str() && *amt == ONE_NEAR.as_yoctonear())
    );
    assert_eq!(c.get_eval(eval_id).unwrap().status, EvalStatus::Refunded);
    // The agent can no longer settle it
    ctx(agent(), NearToken::from_yoctonear(0), 4_001 + sealed::EVAL_TIMEOUT_MS);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.submit_result(eval_id, RunMode::Sealed, 10, 10, 10, EVID.into(), HASH.into());
    }));
    assert!(r.is_err());
}

#[test]
#[should_panic(expected = "Only the requester can reclaim")]
fn only_requester_can_reclaim() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 4_000);
    let eval_id = c.request_eval(id, "Qwen/Qwen3-30B".into());
    ctx(stranger(), NearToken::from_yoctonear(0), 4_000 + sealed::EVAL_TIMEOUT_MS);
    drop(c.reclaim_eval(eval_id));
}

#[test]
#[should_panic(expected = "Only the author can update")]
fn only_author_updates() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(stranger(), NearToken::from_yoctonear(0), 4_000);
    c.update_benchmark(id, Some(NearToken::from_yoctonear(0)), None, None);
}

#[test]
#[should_panic(expected = "Benchmark is retired")]
fn retired_benchmarks_cannot_run() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(author(), NearToken::from_yoctonear(0), 4_000);
    c.update_benchmark(id, None, None, Some(false));
    ctx(requester(), ONE_NEAR.saturating_add(STORAGE), 4_000);
    c.request_eval(id, "Qwen/Qwen3-30B".into());
}

#[test]
#[should_panic(expected = "item_count does not match the sealed set")]
fn reseal_must_match_item_count() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, ONE_NEAR, false);
    ctx(agent(), NearToken::from_yoctonear(0), 4_000);
    let _ = c.seal_benchmark(id, 11);
}

#[test]
fn free_benchmark_runs_without_transfer() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, NearToken::from_yoctonear(0), false);
    ctx(requester(), STORAGE, 4_000);
    let eval_id = c.request_eval(id, "Qwen/Qwen3-30B".into());
    ctx(agent(), NearToken::from_yoctonear(0), 5_000);
    let out = c.submit_result(eval_id, RunMode::Sealed, 10, 10, 10, EVID.into(), HASH.into());
    assert!(matches!(out, PromiseOrValue::Value(true)));
}

#[test]
fn evals_listed_newest_first() {
    let mut c = setup();
    let id = registered_and_sealed(&mut c, NearToken::from_yoctonear(0), false);
    for i in 0..3 {
        ctx(requester(), STORAGE, 4_000 + i);
        c.request_eval(id, format!("model-{i}"));
    }
    let list = c.get_evals(None, None);
    assert_eq!(list.len(), 3);
    assert_eq!(list[0].model, "model-2");
    assert_eq!(c.get_pending_evals(Some(2)).len(), 2);
    assert_eq!(c.get_pending_evals(None)[0].model, "model-0");
}
