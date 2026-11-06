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

// Re-register before the attestation expires (contract default: 7 days)
setInterval(async () => {
  try {
    if (await agent.register()) console.log("Agent re-registered");
  } catch (error) {
    console.error("Re-registration error:", (error as Error).message);
  }
}, 6 * 24 * 60 * 60 * 1000);

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
