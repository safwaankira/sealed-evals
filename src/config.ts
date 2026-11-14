import dotenv from "dotenv";

// Load .env only for local development; in the TEE, Phala injects encrypted env vars.
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ quiet: true });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  agentContractId: required("AGENT_CONTRACT_ID"),
  sponsorAccountId: required("SPONSOR_ACCOUNT_ID"),
  sponsorPrivateKey: required("SPONSOR_PRIVATE_KEY"),
  nearAiApiKey: required("NEARAI_CLOUD_API_KEY"),
  nearAiBaseUrl: process.env.NEARAI_CLOUD_BASE_URL || "https://cloud-api.near.ai",
  nvidiaNrasUrl: process.env.NVIDIA_NRAS_URL || "https://nras.attestation.nvidia.com/v3/attest/gpu",
  networkId: (process.env.NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet") as "mainnet" | "testnet",
  dataDir: process.env.DATA_DIR || "./data",
  port: Number(process.env.PORT || "3000"),
  pollMs: Number(process.env.POLL_MS || "8000"),
  maxTokens: Number(process.env.MAX_TOKENS || "1024"),
  itemConcurrency: Number(process.env.ITEM_CONCURRENCY || "4"),
  /** Operator cost limits: the operator's NEAR AI key pays for inference */
  maxRunItems: Number(process.env.MAX_RUN_ITEMS || "60"),
  /** At most this many runs that actually send questions, per UTC day (resets on reboot too) */
  maxRunsPerDay: Number(process.env.MAX_RUNS_PER_DAY || "30"),
  /**
   * Whose benchmarks this agent will seal and run, and which models it will send questions to.
   * The defaults live in code, so they are part of the measured build anyone can check. "*" = any.
   */
  allowedAuthors: list(process.env.ALLOWED_AUTHORS ?? "pupil-wherever-author.testnet"),
  allowedModels: list(
    process.env.ALLOWED_MODELS ??
      [
        "Qwen/Qwen3.8-27B",
        "Qwen/Qwen3.6-35B-A3B-FP8",
        "z-ai/glm-5.3-flash",
        "deepseek-ai/DeepSeek-V4.1-Flash-1017",
        "z-ai/glm-5.3",
        "moonshotai/kimi-k2.6",
      ].join(","),
  ),
  minPricePerItemYocto: BigInt(process.env.MIN_PRICE_PER_ITEM_YOCTO || "1000000000000000000000"), // 0.001 NEAR
  /** Leaving this unset in local mode is fine; it only seeds the non-TEE fallback keys. */
  localSealSecret: process.env.LOCAL_SEAL_SECRET || "",
  publicDir: process.env.PUBLIC_DIR || "./public",
};

function list(v: string): string[] | "*" {
  const t = v.trim();
  return t === "*" ? "*" : t.split(",").map((x) => x.trim()).filter(Boolean);
}
export const allows = (l: string[] | "*", v: string) => l === "*" || l.includes(v);

export const VERSION = "0.1.0";
