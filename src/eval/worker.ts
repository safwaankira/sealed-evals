// Polls the contract for paid eval requests and runs them one at a time.

import { agent } from "../near/agent";
import { config } from "../config";
import { runEval } from "./runner";
import type { BenchmarkView, EvalView } from "../near/types";

const MAX_ATTEMPTS = 3;
const inFlight = new Set<string>();
const failures = new Map<string, number>();
let lastError: string | null = null;
let lastPollAt: string | null = null;
let completedThisBoot = 0;

export function workerStatus() {
  return { in_flight: [...inFlight], last_poll_at: lastPollAt, last_error: lastError, completed_this_boot: completedThisBoot };
}

/** Page through the whole pending set, oldest id first, so one stuck eval can't hide the rest. */
async function allPending(): Promise<EvalView[]> {
  const out: EvalView[] = [];
  for (let from = 0; ; from += 100) {
    const page = (await agent().view<any>({ methodName: "get_pending_evals", args: { from_index: from, limit: 100 } })) as EvalView[];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out.sort((a, b) => Number(a.id) - Number(b.id));
}

async function tick(): Promise<void> {
  const pending = await allPending();
  lastPollAt = new Date().toISOString();
  for (const ev of pending) {
    if (inFlight.has(ev.id)) continue;
    inFlight.add(ev.id);
    try {
      const attempts = failures.get(ev.id) ?? 0;
      if (attempts >= MAX_ATTEMPTS) {
        // give up cleanly: refund rather than retry (and spend gas) forever
        await agent().call({
          methodName: "fail_eval",
          args: { eval_id: ev.id, reason: "The agent could not settle this run after several attempts. Refunded." },
        });
        failures.delete(ev.id);
        continue;
      }
      const benchmark = (await agent().view<any>({
        methodName: "get_benchmark",
        args: { benchmark_id: ev.benchmark_id },
      })) as BenchmarkView | null;
      if (!benchmark) continue;
      await runEval(ev, benchmark);
      failures.delete(ev.id);
      completedThisBoot++;
    } catch (e) {
      failures.set(ev.id, (failures.get(ev.id) ?? 0) + 1);
      lastError = `eval ${ev.id}: ${(e as Error).message?.slice(0, 200)}`;
      console.error(lastError);
    } finally {
      inFlight.delete(ev.id);
    }
  }
}

export function startWorker(): void {
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
      // keep enough NEAR for gas
      if ((await agent().balance()) < 0.15) await agent().fund(0.3);
    } catch (e) {
      lastError = `poll: ${(e as Error).message?.slice(0, 200)}`;
      console.error(lastError);
    } finally {
      running = false;
    }
  };
  setInterval(loop, config.pollMs);
  void loop();
}
