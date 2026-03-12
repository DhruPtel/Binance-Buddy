// =============================================================================
// @binancebuddy/strategies — Risk Scoring
// Combines on-chain signals into a composite risk score for tokens.
// =============================================================================

import { ethers } from 'ethers';
import type { TokenRiskScore } from '@binancebuddy/core';

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function owner() view returns (address)',
] as const;

const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
] as const;

// Known safe tokens — always score 0 risk
const SAFE_TOKEN_ADDRESSES = new Set([
  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
  '0x55d398326f99059fF775485246999027B3197955', // USDT
  '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
  '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', // CAKE
  '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', // ETH
  '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', // BTCB
].map((a) => a.toLowerCase()));

/**
 * Compute a composite risk score for a token (0-100, higher = more risk).
 * This is a lightweight heuristic check, not a full audit.
 */
export async function scoreTokenRisk(
  provider: ethers.JsonRpcProvider,
  tokenAddress: string,
  pairAddress?: string,
): Promise<TokenRiskScore> {
  const addr = tokenAddress.toLowerCase();

  // Known safe tokens get score 0
  if (SAFE_TOKEN_ADDRESSES.has(addr)) {
    return {
      tokenAddress,
      score: 0,
      isVerified: true,
      isHoneypot: false,
      isLiquidityLocked: true,
      hasAudit: true,
      mintable: false,
      liquidityUsd: 0,
      holderCount: 0,
      flags: [],
    };
  }

  const flags: string[] = [];
  let score = 50; // Start at medium risk for unknown tokens
  let isVerified = false;
  let isLiquidityLocked = false;
  let mintable = false;
  let liquidityUsd = 0;

  // ── Check token metadata ──────────────────────────────────────────────
  try {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [name, symbol, decimals] = await Promise.all([
      contract.name(),
      contract.symbol(),
      contract.decimals(),
    ]);

    if (!name || !symbol) {
      flags.push('no_metadata');
      score += 20;
    } else {
      isVerified = true;
      score -= 10;

      // Suspicious name patterns
      const nameLower = (name as string).toLowerCase();
      if (nameLower.includes('inu') || nameLower.includes('moon') || nameLower.includes('safe')) {
        flags.push('meme_name');
        score += 5;
      }

      if ((decimals as number) !== 18 && (decimals as number) !== 9) {
        flags.push('unusual_decimals');
        score += 5;
      }
    }
  } catch {
    flags.push('unreadable_contract');
    score += 30;
  }

  // ── Check ownership ─────────────────────────────────────────────────
  try {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const owner: string = await contract.owner();
    if (owner.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
      isLiquidityLocked = true;
      score -= 10;
    } else {
      flags.push('owner_not_renounced');
      score += 10;
    }
  } catch {
    // No owner() function — could be renounced via different pattern
    isLiquidityLocked = false;
  }

  // ── Check bytecode for mint function ────────────────────────────────
  try {
    const code = await provider.getCode(tokenAddress);
    // keccak256('mint(address,uint256)') = 0x40c10f19...
    if (code.includes('40c10f19')) {
      mintable = true;
      flags.push('mintable');
      score += 15;
    }
  } catch {
    // ignore
  }

  // ── Check liquidity via pair ─────────────────────────────────────────
  if (pairAddress) {
    try {
      const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
      const [r0, r1]: [bigint, bigint] = await pair.getReserves().then(
        (r: [bigint, bigint, bigint]) => [r[0], r[1]],
      );
      const avgReserve = (r0 + r1) / 2n;
      liquidityUsd = parseFloat(ethers.formatEther(avgReserve)) * 2; // rough estimate

      if (liquidityUsd < 1000) {
        flags.push('very_low_liquidity');
        score += 20;
      } else if (liquidityUsd < 10_000) {
        flags.push('low_liquidity');
        score += 10;
      } else {
        score -= 5;
      }
    } catch {
      flags.push('no_liquidity_data');
      score += 10;
    }
  } else {
    flags.push('no_pair_provided');
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  return {
    tokenAddress,
    score,
    isVerified,
    isHoneypot: score >= 80,
    isLiquidityLocked,
    hasAudit: false, // On-chain only — no audit DB
    mintable,
    liquidityUsd,
    holderCount: 0, // Would require BSCScan API
    flags,
  };
}
