import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia } from "wagmi/chains";
import { http } from "viem";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "81f17a311f51265fd1024a28609f582c";

const isTestnet = process.env.NEXT_PUBLIC_ENABLE_TESTNETS === "true";

export const config = getDefaultConfig({
  appName: "Macket - Confidence Market",
  projectId: walletConnectProjectId,
  chains: [isTestnet ? sepolia : mainnet],
  transports: {
    [mainnet.id]: http(process.env.NEXT_PUBLIC_MAINNET_RPC_URL || undefined),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || undefined),
  },
  ssr: true,
});
