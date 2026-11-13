import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { existsSync } from "fs";
import { config } from "./config";
import { initAgent } from "./near/agent";
import { initKeys } from "./tee/keys";
import { initStore } from "./tee/store";
import { startWorker } from "./eval/worker";
import { markRegistered } from "./registration";
import api from "./routes/api";

const agent = await initAgent();
const keys = await initKeys();
if (process.env.NODE_ENV === "production" && keys.mode !== "tee") {
  // A production image without the dstack socket must never pretend to be sealed
  throw new Error("Production build started outside a TEE (no /var/run/dstack.sock). Refusing to run.");
}
await initStore();
console.log(`Agent ${agent.accountId()} | contract ${config.agentContractId} | TEE mode: ${keys.mode}`);
console.log(`Seal public key: ${keys.sealPublicKeyHex}`);
if (keys.measurements) console.log(`Measurements: ${JSON.stringify(keys.measurements)}`);

// Serve the API and web app first, so this enclave's measurements can be read (and approved)
// before it is registered. Nothing that touches benchmarks works until registration succeeds:
// sealing and settling are agent-only calls the contract refuses to unregistered agents.
const app = new Hono();
app.use("/api/*", cors());
app.route("/api", api);
if (existsSync(config.publicDir)) {
  app.use("/*", serveStatic({ root: config.publicDir }));
  app.get("*", serveStatic({ path: `${config.publicDir}/index.html` }));
}
serve({ fetch: app.fetch, port: config.port });
console.log(`Sealed Evals agent listening on :${config.port}`);

// register() reserves ~0.31 NEAR of gas, so keep comfortably more than that
if ((await agent.balance()) < 0.4) await agent.fund(0.4);

// Register with the contract: in a TEE this submits the attestation the contract verifies.
// Retries slowly, since each failed attempt costs gas while the measurements await approval.
while (true) {
  try {
    const isWhitelisted = await agent.isWhitelisted();
    if (isWhitelisted === null || isWhitelisted) {
      if (await agent.register()) {
        console.log("Agent registered");
        markRegistered();
        break;
      }
    }
  } catch (error) {
    console.error("Registration error:", (error as Error).message?.slice(0, 300));
  }
  console.log("Not registered yet (measurements or PPID not approved?). Retrying in 60s");
  await new Promise((r) => setTimeout(r, 60_000));
}

// Publish the seal key on chain: only attested code can, so the web app trusts this copy
async function publishSealKey() {
  const onChain = await agent.view<any>({ methodName: "get_seal_key", args: { account_id: agent.accountId() } });
  if (onChain !== keys.sealPublicKeyHex) {
    await agent.call({ methodName: "set_seal_key", args: { public_key: keys.sealPublicKeyHex } });
    console.log("Seal key published on chain");
  }
}
await publishSealKey().catch((e) => console.error("Publishing seal key failed:", (e as Error).message));

// Re-register daily (attestations last 7 days), retrying every 5 minutes after a failure
async function keepRegistered() {
  try {
    if (await agent.register()) console.log("Agent re-registered");
    await publishSealKey();
    setTimeout(keepRegistered, 24 * 60 * 60 * 1000);
  } catch (error) {
    console.error("Re-registration error:", (error as Error).message);
    setTimeout(keepRegistered, 5 * 60 * 1000);
  }
}
setTimeout(keepRegistered, 24 * 60 * 60 * 1000);

startWorker();
