// =============================================================================
// @binancebuddy/strategies — Token Launch Sniper
// Listens for PairCreated events on PancakeSwap V2 factory.
// Runs safety checks and surfaces new pairs to the user for manual confirmation.
// Auto-buy is NOT implemented — manual confirm required.
// =============================================================================

import { ethers } from 'ethers';
import type { NewPairInfo } from '@binancebuddy/core';
import { PANCAKESWAP_V2_FACTORY, WBNB_ADDRESS } from '@binancebuddy/core';

// ---------------------------------------------------------------------------
// ABIs (minimal, inlined to keep the package self-contained)
// ---------------------------------------------------------------------------

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function owner() view returns (address)',
  'function totalSupply() view returns (uint256)',
] as const;

const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
] as const;

const FACTORY_ABI = [
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SniperCallback = (pair: NewPairInfo) => void | Promise<void>;

export interface SniperConfig {
  /** Minimum BNB liquidity to surface a pair (default: 0.5 BNB) */
  minLiquidityBnb?: number;
  /** Only alert on WBNB-paired tokens (default: true) */
  bnbPairOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _active = false;
let _stopFn: (() => void) | null = null;

// ---------------------------------------------------------------------------
// assessNewPair
// ---------------------------------------------------------------------------

/**
 * Assess a newly created pair for rug/honeypot risk signals.
 * Returns a NewPairInfo with risk assessment that can be shown to the user.
 */
export async function assessNewPair(
  provider: ethers.JsonRpcProvider,
  pairAddress: string,
  token0: string,
  token1: string,
): Promise<NewPairInfo> {
  const isToken0Wbnb = token0.toLowerCase() === WBNB_ADDRESS.toLowerCase();
  const newTokenAddr = isToken0Wbnb ? token1 : token0;

  // ── Read token symbols ──────────────────────────────────────────────────
  let token0Symbol = 'UNKNOWN';
  let token1Symbol = 'UNKNOWN';
  let isVerified = false;

  try {
    const t0 = new ethers.Contract(token0, ERC20_ABI, provider);
    const t1 = new ethers.Contract(token1, ERC20_ABI, provider);
    [token0Symbol, token1Symbol] = await Promise.all([t0.symbol(), t1.symbol()]);
    isVerified = true;
  } catch {
    // Can't read symbol — very suspicious for a newly launched token
    isVerified = false;
  }

  // ── Read initial liquidity ──────────────────────────────────────────────
  let initialLiquidityBnb = 0;
  try {
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const [r0, r1]: [bigint, bigint] = await pair.getReserves().then(
      (r: [bigint, bigint, bigint]) => [r[0], r[1]],
    );
    const bnbReserve = isToken0Wbnb ? r0 : r1;
    initialLiquidityBnb = parseFloat(ethers.formatEther(bnbReserve));
  } catch {
    initialLiquidityBnb = 0;
  }

  // ── Check ownership ─────────────────────────────────────────────────────
  // Renounced ownership (zero address) is a positive signal.
  let isLiquidityLocked = false;
  try {
    const newToken = new ethers.Contract(newTokenAddr, ERC20_ABI, provider);
    const owner: string = await newToken.owner();
    isLiquidityLocked = owner.toLowerCase() === ethers.ZeroAddress.toLowerCase();
  } catch {
    // owner() not present — cannot determine; treat as unknown (not locked)
    isLiquidityLocked = false;
  }

  // ── Derive honeypot risk heuristically ─────────────────────────────────
  // This is NOT a full honeypot simulation — it's a quick surface check.
  // Full simulation would require eth_call buy+sell, which is expensive.
  let honeypotRisk: NewPairInfo['honeypotRisk'] = 'high';
  if (isVerified && initialLiquidityBnb >= 5 && isLiquidityLocked) {
    honeypotRisk = 'low';
  } else if (isVerified && initialLiquidityBnb >= 1) {
    honeypotRisk = 'medium';
  }

  return {
    pairAddress,
    token0,
    token1,
    token0Symbol,
    token1Symbol,
    createdAt: Date.now(),
    initialLiquidityBnb,
    isVerified,
    isLiquidityLocked,
    honeypotRisk,
  };
}

// ---------------------------------------------------------------------------
// startSniper / stopSniper
// ---------------------------------------------------------------------------

/**
 * Start listening for PairCreated events on the PancakeSwap V2 factory.
 * Calls `onNewPair` for each pair that passes the configured thresholds.
 *
 * Returns a stop function. Also available via stopSniper().
 */
export function startSniper(
  provider: ethers.JsonRpcProvider,
  onNewPair: SniperCallback,
  config: SniperConfig = {},
): () => void {
  if (_active) {
    throw new Error('Sniper already active — call stopSniper() first.');
  }

  const minLiquidity = config.minLiquidityBnb ?? 0.5;
  const bnbOnly = config.bnbPairOnly ?? true;

  _active = true;

  const factory = new ethers.Contract(PANCAKESWAP_V2_FACTORY, FACTORY_ABI, provider);

  const handler = async (token0: string, token1: string, pairAddress: string) => {
    if (bnbOnly) {
      const hasWbnb =
        token0.toLowerCase() === WBNB_ADDRESS.toLowerCase() ||
        token1.toLowerCase() === WBNB_ADDRESS.toLowerCase();
      if (!hasWbnb) return;
    }

    try {
      const info = await assessNewPair(provider, pairAddress, token0, token1);
      if (info.initialLiquidityBnb >= minLiquidity) {
        await onNewPair(info);
      }
    } catch {
      // Skip assessment failures silently — malformed tokens are common
    }
  };

  factory.on('PairCreated', handler);

  const stop = () => {
    factory.off('PairCreated', handler);
    _active = false;
    _stopFn = null;
  };

  _stopFn = stop;
  return stop;
}

export function stopSniper(): void {
  if (_stopFn) {
    _stopFn();
  } else {
    _active = false;
  }
}

export function isSniperActive(): boolean {
  return _active;
}
