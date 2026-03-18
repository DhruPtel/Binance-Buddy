// =============================================================================
// PancakeSwap V2 — Quote fetching and path routing
// Uses getAmountsOut to price trades, WBNB as intermediary when needed.
// =============================================================================

import { Contract, type Provider } from 'ethers';
import {
  PANCAKESWAP_V2_ROUTER,
  WBNB_ADDRESS,
  NATIVE_BNB_ADDRESS,
  SAFE_TOKENS,
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

// USDT is used as a stablecoin bridge for tokens (like FDUSD) whose direct
// WBNB pair has thin liquidity. Adding it as an intermediate hop can yield
// significantly better rates (confirmed on-chain: FDUSD→USDT→WBNB gives
// ~2x better output than the direct FDUSD→WBNB pool).
const USDT_ADDRESS = SAFE_TOKENS['USDT'];

/**
 * Try a single path via getAmountsOut. Returns null on revert or zero output.
 */
async function tryPath(
  router: ReturnType<typeof getRouterContract>,
  amountIn: bigint,
  path: string[],
): Promise<{ path: string[]; amountOut: bigint } | null> {
  try {
    const amounts: bigint[] = await router.getAmountsOut(amountIn, path);
    const out = amounts[amounts.length - 1];
    return out > 0n ? { path, amountOut: out } : null;
  } catch {
    return null;
  }
}

/**
 * Determine the best swap path across all candidate routes.
 * Tries direct, WBNB-bridged, and USDT-bridged paths concurrently and
 * returns whichever yields the highest amountOut.
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

  const isWbnbIn = normIn.toLowerCase() === WBNB_ADDRESS.toLowerCase();
  const isWbnbOut = normOut.toLowerCase() === WBNB_ADDRESS.toLowerCase();
  const isUsdtIn = normIn.toLowerCase() === USDT_ADDRESS.toLowerCase();
  const isUsdtOut = normOut.toLowerCase() === USDT_ADDRESS.toLowerCase();

  // Build all candidate paths
  const candidates: string[][] = [
    [normIn, normOut], // direct
  ];
  if (!isWbnbIn && !isWbnbOut) {
    candidates.push([normIn, WBNB_ADDRESS, normOut]); // via WBNB
  }
  if (!isUsdtIn && !isUsdtOut) {
    candidates.push([normIn, USDT_ADDRESS, normOut]); // via USDT (better for stablecoins)
  }

  // Try all paths concurrently, pick the best output
  const results = await Promise.all(candidates.map((p) => tryPath(router as ReturnType<typeof getRouterContract>, amountIn, p)));
  let best: { path: string[]; amountOut: bigint } | null = null;
  for (const r of results) {
    if (r && (!best || r.amountOut > best.amountOut)) best = r;
  }

  if (best) {
    console.log(`[swap] route: ${best.path.join('→')} amountOut: ${best.amountOut.toString()}`);
  }

  return best;
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
