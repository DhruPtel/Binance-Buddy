// =============================================================================
// @binancebuddy/blockchain — Profile Builder (Scanner)
// Orchestrates token scan + tx history into a UserProfile.
// =============================================================================

import type { JsonRpcProvider, FallbackProvider } from 'ethers';
import { formatEther } from 'ethers';
import type {
  UserProfile,
  TraderArchetype,
  TradingFrequency,
  ProtocolUsage,
  WalletState,
  TokenInfo,
} from '@binancebuddy/core';
import {
  BSC_CHAIN_ID,
  KNOWN_PROTOCOLS,
  SAFE_TOKENS,
} from '@binancebuddy/core';
import { getBnbBalance } from './provider.js';
import { scanTokens, getBnbPriceUsd } from './tokens.js';
import {
  fetchTransactionHistory,
  countByCategory,
  getProtocolUsage,
} from './history.js';

// ---------------------------------------------------------------------------
// Full wallet scan → WalletState
// ---------------------------------------------------------------------------

/**
 * Perform a full wallet scan: BNB balance + all BEP-20 tokens with prices.
 * Returns a complete WalletState.
 */
export async function scanWallet(
  provider: JsonRpcProvider | FallbackProvider,
  walletAddress: string,
  ankrApiKey?: string,
  coingeckoApiKey?: string,
): Promise<WalletState> {
  const [bnbBalanceRaw, tokens, bnbPrice] = await Promise.all([
    getBnbBalance(provider, walletAddress),
    scanTokens(provider, walletAddress, ankrApiKey),
    getBnbPriceUsd(coingeckoApiKey),
  ]);

  const bnbBalanceFormatted = parseFloat(formatEther(bnbBalanceRaw));
  const bnbValueUsd = bnbBalanceFormatted * bnbPrice;
  const tokensValueUsd = tokens.reduce((sum, t) => sum + t.valueUsd, 0);

  return {
    address: walletAddress,
    chainId: BSC_CHAIN_ID,
    bnbBalance: bnbBalanceRaw.toString(),
    bnbBalanceFormatted,
    tokens,
    totalValueUsd: bnbValueUsd + tokensValueUsd,
    lastScanned: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Profile builder → UserProfile
// ---------------------------------------------------------------------------

/**
 * Build a complete UserProfile from transaction history and token holdings.
 */
export async function buildProfile(
  walletAddress: string,
  tokens: TokenInfo[],
  ankrApiKey?: string,
): Promise<UserProfile> {
  const txs = await fetchTransactionHistory(walletAddress, ankrApiKey);
  const categoryCounts = countByCategory(txs);
  const protocolUsage = getProtocolUsage(txs);

  const totalTxCount = txs.length;
  const archetype = determineArchetype(categoryCounts, tokens, totalTxCount);
  const riskScore = calculateRiskScore(tokens, categoryCounts);
  const tradingFrequency = determineTradingFrequency(txs);
  const avgTradeSize = calculateAvgTradeSize(txs);
  const preferredTokens = getPreferredTokens(tokens);

  // Map protocol usage to ProtocolUsage[]
  const protocols: ProtocolUsage[] = protocolUsage.map((p) => {
    const knownProto = Object.values(KNOWN_PROTOCOLS).find((k) => k.name === p.protocol);
    return {
      name: p.protocol,
      contractAddresses: knownProto?.addresses ?? [],
      interactionCount: p.count,
      lastUsed: p.lastUsed,
      category: (knownProto?.category ?? 'other') as ProtocolUsage['category'],
    };
  });

  return {
    address: walletAddress,
    archetype,
    riskScore,
    protocols,
    preferredTokens,
    avgTradeSize,
    tradingFrequency,
    totalTxCount,
  };
}

// ---------------------------------------------------------------------------
// Archetype detection
// ---------------------------------------------------------------------------

function determineArchetype(
  counts: Record<string, number>,
  tokens: TokenInfo[],
  totalTxCount: number,
): TraderArchetype {
  if (totalTxCount < 10) return 'newcomer';

  const swaps = (counts.swap ?? 0) + (counts.snipe ?? 0);
  const farms = (counts.farm_enter ?? 0) + (counts.farm_exit ?? 0);
  const stakes = (counts.stake ?? 0) + (counts.unstake ?? 0);
  const transfers = counts.transfer ?? 0;

  const totalActions = swaps + farms + stakes + transfers || 1;

  const swapRatio = swaps / totalActions;
  const farmRatio = farms / totalActions;

  // Check for meme/degen tokens (tokens not in SAFE_TOKENS list)
  const safeAddresses = new Set(
    Object.values(SAFE_TOKENS).map((a) => a.toLowerCase()),
  );
  const unknownTokenCount = tokens.filter(
    (t) => !safeAddresses.has(t.address.toLowerCase()),
  ).length;
  const degenRatio = tokens.length > 0 ? unknownTokenCount / tokens.length : 0;

  if (degenRatio > 0.6 && swapRatio > 0.3) return 'degen';
  if (farmRatio > 0.2) return 'farmer';
  if (swapRatio > 0.4) return 'swapper';
  if (totalTxCount < 50 && transfers / totalActions > 0.5) return 'holder';

  return 'holder';
}

// ---------------------------------------------------------------------------
// Risk score (1-10)
// ---------------------------------------------------------------------------

function calculateRiskScore(
  tokens: TokenInfo[],
  counts: Record<string, number>,
): number {
  let score = 3; // baseline

  // Unknown/meme tokens increase risk
  const safeAddresses = new Set(
    Object.values(SAFE_TOKENS).map((a) => a.toLowerCase()),
  );
  const unknownCount = tokens.filter(
    (t) => !safeAddresses.has(t.address.toLowerCase()),
  ).length;

  if (tokens.length > 0) {
    const unknownRatio = unknownCount / tokens.length;
    score += Math.round(unknownRatio * 4); // up to +4
  }

  // High swap frequency increases risk
  const swaps = (counts.swap ?? 0) + (counts.snipe ?? 0);
  if (swaps > 100) score += 2;
  else if (swaps > 30) score += 1;

  // Snipes are high risk
  if ((counts.snipe ?? 0) > 0) score += 1;

  return Math.min(10, Math.max(1, score));
}

// ---------------------------------------------------------------------------
// Trading frequency
// ---------------------------------------------------------------------------

function determineTradingFrequency(
  txs: { timestamp: number }[],
): TradingFrequency {
  if (txs.length < 5) return 'rare';

  // Look at the time span of transactions
  const timestamps = txs.map((t) => t.timestamp).sort((a, b) => a - b);
  const firstTx = timestamps[0];
  const lastTx = timestamps[timestamps.length - 1];
  const spanDays = Math.max(1, (lastTx - firstTx) / 86400);
  const txPerDay = txs.length / spanDays;

  if (txPerDay >= 10) return 'hyperactive';
  if (txPerDay >= 1) return 'daily';
  if (txPerDay >= 0.14) return 'weekly'; // ~1 per week
  return 'rare';
}

// ---------------------------------------------------------------------------
// Average trade size
// ---------------------------------------------------------------------------

function calculateAvgTradeSize(
  txs: { value: string; category: string }[],
): number {
  const tradeTxs = txs.filter((t) =>
    t.category === 'swap' || t.category === 'snipe',
  );
  if (tradeTxs.length === 0) return 0;

  const totalWei = tradeTxs.reduce(
    (sum, t) => sum + BigInt(t.value || '0'),
    0n,
  );
  const avgWei = totalWei / BigInt(tradeTxs.length);
  // Convert to BNB (rough — doesn't include token values, just BNB sent)
  return parseFloat(formatEther(avgWei));
}

// ---------------------------------------------------------------------------
// Preferred tokens
// ---------------------------------------------------------------------------

function getPreferredTokens(tokens: TokenInfo[]): string[] {
  // Top 5 tokens by USD value
  return tokens
    .filter((t) => t.valueUsd > 0)
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, 5)
    .map((t) => t.address);
}
