// Polls the contract for paid eval requests and runs them one at a time.

import { agent } from "../near/agent";
import { config } from "../config";
import { runEval } from "./runner";
import type { BenchmarkView, EvalView } from "../near/types";

const inFlight = new Set<string>();
let lastError: string | null = null;
let lastPollAt: string | null = null;
let completedThisBoot = 0;

export function workerStatus() {
  return { in_flight: [...inFlight], last_poll_at: lastPollAt, last_error: lastError, completed_this_boot: completedThisBoot };
}

async function tick(): Promise<void> {
  const pending = await agent().view<EvalView[]>({ methodName: "get_pending_evals", args: { limit: 10 } });
  lastPollAt = new Date().toISOString();
  for (const ev of pending) {
    if (inFlight.has(ev.id)) continue;
    inFlight.add(ev.id);
    try {
      const benchmark = (await agent().view<any>({
        methodName: "get_benchmark",
        args: { benchmark_id: ev.benchmark_id },
      })) as BenchmarkView | null;
      if (!benchmark) continue;
      await runEval(ev, benchmark);
      completedThisBoot++;
    } catch (e) {
      lastError = `eval ${ev.id}: ${(e as Error).message?.slice(0, 200)}`;
      console.error(lastError);
      // Settlement failed (e.g. RPC hiccup); the eval stays pending and is retried next tick,
      // and the requester can always reclaim after the timeout.
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
