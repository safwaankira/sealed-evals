import { ShadeClient, addSensitive } from "@neardefi/shade-agent-js";
import { config } from "../config";

let client: ShadeClient | null = null;

export async function initAgent(): Promise<ShadeClient> {
  // make sure the NEAR AI key can never show up in a logged error
  const escaped = config.nearAiApiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  addSensitive({
    keys: ["nearAiApiKey", "NEARAI_CLOUD_API_KEY", "authorization", "Authorization"],
    patterns: [{ pattern: new RegExp(escaped, "g"), replacer: (v, p) => v.replace(p, "[redacted]") }],
  });
  client = await ShadeClient.create({
    networkId: config.networkId,
    agentContractId: config.agentContractId,
    sponsor: { accountId: config.sponsorAccountId, privateKey: config.sponsorPrivateKey },
    // Only used outside a TEE to get a stable local agent account
    derivationPath: config.sponsorPrivateKey,
  });
  return client;
}

export function agent(): ShadeClient {
  if (!client) throw new Error("Agent not initialised");
  return client;
}

/** Test hook: swap in a fake client (never used at runtime). */
export function setAgentForTests(fake: unknown): void {
  client = fake as ShadeClient;
}
