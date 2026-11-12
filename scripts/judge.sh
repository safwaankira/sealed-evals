#!/usr/bin/env bash
# One command for judges and screeners: runs every check behind the claims in TRUST.md.
# Needs Node 20+ and Rust. No wallet, no keys, no network accounts.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/3 Agent: envelope crypto, graders, and an end-to-end run against mock NEAR AI + NVIDIA =="
npm ci --silent
npm test 2>&1 | grep -E "^(ok|not ok)|^# (tests|pass|fail)"

echo
echo "== 2/3 Contract: escrow, agent-only settlement, Sealed rule, refunds =="
# the pinned toolchain (rust-toolchain.toml) is for the wasm build; tests run on stable too
(cd agent-contract && { cargo test --lib 2>&1 || cargo +stable test --lib 2>&1; } | grep -E "test result: ok")

echo
echo "== 3/3 Web app builds (the same build ships inside the attested image) =="
(cd frontend && npm ci --silent && npm run build 2>&1 | grep -E "built in|error")

echo
echo "All checks passed. Claim-by-claim map: TRUST.md"
