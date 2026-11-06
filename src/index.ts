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

if ((await agent.balance()) < 0.2) await agent.fund(0.3);

// Register with the contract: in a TEE this submits the attestation the contract verifies
while (true) {
  try {
    const isWhitelisted = await agent.isWhitelisted();
    if (isWhitelisted === null || isWhitelisted) {
      if (await agent.register()) {
        console.log("Agent registered");
        break;
      }
    }
  } catch (error) {
    console.error("Registration error:", (error as Error).message);
  }
  console.log("Waiting to be whitelisted (local mode) or for registration to succeed...");
  await new Promise((r) => setTimeout(r, 10_000));
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

const app = new Hono();
app.use("/api/*", cors());
app.route("/api", api);

// The web app is built into the same image, so the UI people use is part of the attested code
if (existsSync(config.publicDir)) {
  app.use("/*", serveStatic({ root: config.publicDir }));
  app.get("*", serveStatic({ path: `${config.publicDir}/index.html` }));
}

startWorker();
serve({ fetch: app.fetch, port: config.port });
console.log(`Sealed Evals agent listening on :${config.port}`);
