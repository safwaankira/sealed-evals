// Chain reads (RPC) and wallet writes (NEAR Connect) for the Sealed Evals contract.
import { JsonRpcProvider } from "@near-js/providers";
import { NearConnector } from "@hot-labs/near-connect";
import { apiGet } from "./api";

const RPC = {
  testnet: "https://test.rpc.fastnear.com",
  mainnet: "https://free.rpc.fastnear.com",
};

let configPromise = null;
/** Contract id and network come from the agent, so the UI always talks to the contract the TEE uses. */
export function getConfig() {
  if (!configPromise) {
    configPromise = apiGet("/agent-info").then((info) => ({
      contractId: info.contract_id,
      network: info.network === "mainnet" ? "mainnet" : "testnet",
      agent: info,
    }));
    configPromise.catch(() => (configPromise = null));
  }
  return configPromise;
}

let provider = null;
async function rpc() {
  if (!provider) {
    const { network } = await getConfig();
    provider = new JsonRpcProvider({ url: RPC[network] });
  }
  return provider;
}

export async function view(methodName, args = {}) {
  const { contractId } = await getConfig();
  return (await rpc()).callFunction(contractId, methodName, args);
}

export function explorerTx(network, hash) {
  return network === "mainnet" ? `https://nearblocks.io/txns/${hash}` : `https://testnet.nearblocks.io/txns/${hash}`;
}
export function explorerAccount(network, account) {
  return network === "mainnet"
    ? `https://nearblocks.io/address/${account}`
    : `https://testnet.nearblocks.io/address/${account}`;
}

// ---------- wallet ----------

let connector = null;
let state = { accountId: null, ready: false };
const listeners = new Set();
function set(next) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}
export const walletStore = {
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
};

export async function initWallet() {
  if (connector) return;
  const { network } = await getConfig();
  connector = new NearConnector({
    network,
    features: { signAndSendTransaction: true, ...(network === "testnet" ? { testnet: true } : {}) },
  });
  connector.on("wallet:signIn", (e) => set({ accountId: e.accounts?.[0]?.accountId ?? null }));
  connector.on("wallet:signOut", () => set({ accountId: null }));
  try {
    const { accounts } = await connector.getConnectedWallet();
    set({ accountId: accounts?.[0]?.accountId ?? null });
  } catch {
    // not connected yet
  }
  set({ ready: true });
}

export async function connectWallet() {
  await initWallet();
  await connector.connect();
}

export async function disconnectWallet() {
  if (!connector) return;
  await connector.disconnect();
  set({ accountId: null });
}

function decodeReturn(outcome) {
  const status = outcome?.status;
  if (status && typeof status === "object" && "Failure" in status) {
    const f = JSON.stringify(status.Failure);
    const m = f.match(/"ExecutionError":"([^"]+)"/) || f.match(/Smart contract panicked: ([^"\\]+)/);
    throw new Error(m ? m[1].replace(/^Smart contract panicked: /, "") : "Transaction failed");
  }
  // a receipt can fail even when the top-level status looks fine
  for (const r of outcome?.receipts_outcome ?? []) {
    const fail = r?.outcome?.status?.Failure;
    if (fail) {
      const m = JSON.stringify(fail).match(/Smart contract panicked: ([^"\\]+)/);
      throw new Error(m ? m[1] : "Transaction failed");
    }
  }
  const v = status?.SuccessValue;
  if (!v) return null;
  try {
    return JSON.parse(atob(v));
  } catch {
    return null;
  }
}

/** Sign and send one contract call. Returns { value, hash }. */
export async function call(methodName, args, depositYocto = "0", gas = "100000000000000") {
  await initWallet();
  const { contractId } = await getConfig();
  if (!state.accountId) await connector.connect();
  const wallet = await connector.wallet();
  const outcome = await wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [{ type: "FunctionCall", params: { methodName, args, gas, deposit: String(depositYocto) } }],
  });
  return { value: decodeReturn(outcome), hash: outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id ?? null };
}
