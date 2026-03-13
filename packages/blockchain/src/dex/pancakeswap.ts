// =============================================================================
// PancakeSwap V2 — Quote fetching and path routing
// Uses getAmountsOut to price trades, WBNB as intermediary when needed.
// =============================================================================

import { Contract, type Provider } from 'ethers';
import {
  PANCAKESWAP_V2_ROUTER,
  WBNB_ADDRESS,
  NATIVE_BNB_ADDRESS,
} from '@binancebuddy/core';
import type { SwapParams, SwapQuote } from '@binancebuddy/core';

// ---------------------------------------------------------------------------
// ABIs (minimal — only what we need)
// ---------------------------------------------------------------------------

const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
];

// ---------------------------------------------------------------------------
// Path building
// ---------------------------------------------------------------------------

/**
 * Determine the best swap path. Tries direct pair first; if that fails,
 * routes through WBNB. Returns null if neither path works.
 */
export async function findBestPath(
  provider: Provider,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): Promise<{ path: string[]; amountOut: bigint } | null> {
  const router = new Contract(PANCAKESWAP_V2_ROUTER, ROUTER_ABI, provider);

  // PancakeSwap pairs use WBNB, not the native BNB sentinel address (0xEeee...).
  // Normalize before building paths; the executor handles native vs wrapped distinction.
  const normIn = tokenIn.toLowerCase() === NATIVE_BNB_ADDRESS.toLowerCase() ? WBNB_ADDRESS : tokenIn;
  const normOut = tokenOut.toLowerCase() === NATIVE_BNB_ADDRESS.toLowerCase() ? WBNB_ADDRESS : tokenOut;

  // Try direct path first
  const directPath = [normIn, normOut];
  try {
    const amounts: bigint[] = await router.getAmountsOut(amountIn, directPath);
    if (amounts[1] > 0n) {
      return { path: directPath, amountOut: amounts[1] };
    }
  } catch {
    // No direct pair — try via WBNB
  }

  // Route through WBNB (skip if tokenIn or tokenOut is already WBNB)
  if (normIn.toLowerCase() !== WBNB_ADDRESS.toLowerCase() &&
      normOut.toLowerCase() !== WBNB_ADDRESS.toLowerCase()) {
    const wbnbPath = [normIn, WBNB_ADDRESS, normOut];
    try {
      const amounts: bigint[] = await router.getAmountsOut(amountIn, wbnbPath);
      if (amounts[2] > 0n) {
        return { path: wbnbPath, amountOut: amounts[2] };
      }
    } catch {
      // Path through WBNB also failed
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Quote fetching
// ---------------------------------------------------------------------------

/**
 * Get a swap quote for the given params. Returns null if no liquidity path found.
 */
export async function getSwapQuote(
  provider: Provider,
  params: SwapParams,
  bnbPriceUsd: number,
): Promise<SwapQuote | null> {
  const amountIn = BigInt(params.amountIn);

  const result = await findBestPath(provider, params.tokenIn, params.tokenOut, amountIn);
  if (!result) return null;

  const { path, amountOut } = result;

  // Apply slippage to get minimum output
  const slippageFactor = 10_000n - BigInt(params.slippageBps);
  const amountOutMin = (amountOut * slippageFactor) / 10_000n;

  // Estimate price impact (simplified — for display only)
  // A true calculation requires reserve data from the pair contract.
  // We use a conservative 0.3% floor + scale with trade size as a proxy.
  const priceImpact = 0.3;

  // Gas estimate: 150k for single-hop, 220k for multi-hop via WBNB
  const gasEstimate = path.length > 2 ? 220_000n : 150_000n;

  // Gas cost in BNB (using provider gas price)
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 3_000_000_000n; // 3 gwei fallback
  const gasCostWei = gasEstimate * gasPrice;
  const gasCostBnb = Number(gasCostWei) / 1e18;
  const gasCostUsd = gasCostBnb * bnbPriceUsd;

  return {
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    amountOutMin: amountOutMin.toString(),
    priceImpact,
    path,
    gasEstimate: gasEstimate.toString(),
    gasCostBnb: gasCostBnb.toFixed(6),
    gasCostUsd,
  };
}

// ---------------------------------------------------------------------------
// Contract accessor (for executor)
// ---------------------------------------------------------------------------

export function getRouterContract(provider: Provider): Contract {
  return new Contract(PANCAKESWAP_V2_ROUTER, ROUTER_ABI, provider);
}
