import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";

/**
 * Robinhood Chain mainnet — Arbitrum Orbit L2, gas in ETH.
 * Chain ID 4663 (testnet is 46630). Public RPC is rate-limited; for launch
 * traffic swap in a provider URL (Alchemy, Chainstack, QuickNode…) via env.
 */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

const projectId = String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "").replace(/[^\x21-\x7E]/g, "");
if (!projectId) {
  console.warn("VITE_WALLETCONNECT_PROJECT_ID missing — browser wallets work, WalletConnect (mobile QR) won't.");
}

export const wagmiConfig = getDefaultConfig({
  appName: "Reptilio",
  projectId: projectId || "00000000000000000000000000000000",
  chains: [robinhoodChain],
  ssr: false,
});
