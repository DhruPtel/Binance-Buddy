// =============================================================================
// Gas Estimation — estimate gas cost in BNB and USD for swap/approve txs
// =============================================================================

import type { Provider } from 'ethers';

export interface GasEstimate {
  gasLimit: bigint;
  gasPrice: bigint;      // wei
  gasCostWei: bigint;
  gasCostBnb: string;   // formatted to 6 dp
  gasCostUsd: number;
}

// ---------------------------------------------------------------------------
// Fetch current gas price
// ---------------------------------------------------------------------------

export async function getGasPrice(provider: Provider): Promise<bigint> {
  const feeData = await provider.getFeeData();
  // BSC uses legacy gas pricing (no EIP-1559)
  return feeData.gasPrice ?? 3_000_000_000n; // 3 gwei fallback
}

// ---------------------------------------------------------------------------
// Estimate gas cost for a given gas limit
// ---------------------------------------------------------------------------

export async function estimateGasCost(
  provider: Provider,
  gasLimit: bigint,
  bnbPriceUsd: number,
): Promise<GasEstimate> {
  const gasPrice = await getGasPrice(provider);
  const gasCostWei = gasLimit * gasPrice;
  const gasCostBnb = Number(gasCostWei) / 1e18;
  const gasCostUsd = gasCostBnb * bnbPriceUsd;

  return {
    gasLimit,
    gasPrice,
    gasCostWei,
    gasCostBnb: gasCostBnb.toFixed(6),
    gasCostUsd,
  };
}

// ---------------------------------------------------------------------------
// Simulate a transaction via eth_call to get gas estimate and detect reverts
// ---------------------------------------------------------------------------

export interface SimulationResult {
  success: boolean;
  gasEstimate?: bigint;
  revertReason?: string;
}

export async function simulateTransaction(
  provider: Provider,
  tx: {
    to: string;
    data: string;
    value?: bigint;
    from?: string;
  },
): Promise<SimulationResult> {
  try {
    // eth_estimateGas internally does an eth_call — if it reverts, it throws
    const gasEstimate = await provider.estimateGas({
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
      from: tx.from,
    });

    return { success: true, gasEstimate };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Extract revert reason from error message if present
    const revertMatch = message.match(/reverted with reason string '(.+?)'/);
    const revertReason = revertMatch ? revertMatch[1] : message.slice(0, 100);
    return { success: false, revertReason };
  }
}
