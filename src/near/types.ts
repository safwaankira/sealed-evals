// JSON shapes returned by the Sealed Evals contract views (u64s arrive as strings).

export type RunMode = "Sealed" | "LeakRisk";
export type EvalStatus = "Pending" | "Completed" | "Failed" | "Refunded";

export interface BenchmarkView {
  id: string;
  author: string;
  name: string;
  description: string;
  set_hash: string;
  price: string; // yoctoNEAR
  allow_leak_risk: boolean;
  active: boolean;
  item_count: number;
  sealed: boolean;
  sealed_by: string | null;
  sealed_at_ms: string | null;
  created_ms: string;
  runs: number;
  earned: string; // yoctoNEAR
}

export interface EvalResult {
  mode: RunMode;
  correct: number;
  total: number;
  score_bps: number;
  verified_responses: number;
  evidence_hash: string;
  model_attestation_hash: string;
  agent: string;
  completed_ms: string;
}

export interface EvalView {
  id: string;
  requester: string;
  benchmark_id: string;
  model: string;
  paid: string;
  status: EvalStatus;
  created_ms: string;
  allow_leak_risk: boolean;
  claimed_ms: string | null;
  result: EvalResult | null;
  failure_reason: string | null;
}
