// Defaults so modules that read config can load in unit tests.
process.env.AGENT_CONTRACT_ID ??= "sealed.testnet";
process.env.SPONSOR_ACCOUNT_ID ??= "sponsor.testnet";
process.env.SPONSOR_PRIVATE_KEY ??= "ed25519:test";
process.env.NEARAI_CLOUD_API_KEY ??= "sk-test";
