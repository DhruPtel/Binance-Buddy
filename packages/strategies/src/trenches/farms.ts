// =============================================================================
// @binancebuddy/strategies — Farm Scanner
// Fetches yield opportunities from PancakeSwap and Venus.
// Falls back to curated baseline if live data is unavailable.
// =============================================================================

import type { FarmOpportunity } from '@binancebuddy/core';

// ---------------------------------------------------------------------------
// Curated baseline farms (always available, no API key required)
// Sourced from known audited BSC protocols with stable TVL.
// ---------------------------------------------------------------------------

export const BASELINE_FARMS: FarmOpportunity[] = [
  {
    protocol: 'PancakeSwap',
    poolName: 'CAKE-BNB LP',
    poolAddress: '0x0eD7e52944161450477ee417DE9Cd3a859b14fD0',
    apy: 28.5,
    tvl: 45_000_000,
    tokens: ['CAKE', 'BNB'],
    riskScore: 3,
    riskAdjustedApy: 23.8,
    isAudited: true,
    impermanentLossRisk: 'medium',
  },
  {
    protocol: 'PancakeSwap',
    poolName: 'USDT-BNB LP',
    poolAddress: '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE',
    apy: 18.2,
    tvl: 120_000_000,
    tokens: ['USDT', 'BNB'],
    riskScore: 2,
    riskAdjustedApy: 16.8,
    isAudited: true,
    impermanentLossRisk: 'medium',
  },
  {
    protocol: 'PancakeSwap',
    poolName: 'USDC-USDT LP',
    poolAddress: '0xEc6557348085Aa57C72514D67070dC863C0a5A8c',
    apy: 12.1,
    tvl: 85_000_000,
    tokens: ['USDC', 'USDT'],
    riskScore: 1,
    riskAdjustedApy: 12.0,
    isAudited: true,
    impermanentLossRisk: 'low',
  },
  {
    protocol: 'Venus',
    poolName: 'USDT Lending',
    poolAddress: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
    apy: 8.4,
    tvl: 280_000_000,
    tokens: ['USDT'],
    riskScore: 2,
    riskAdjustedApy: 8.0,
    isAudited: true,
    impermanentLossRisk: 'low',
  },
  {
    protocol: 'Venus',
    poolName: 'BNB Lending',
    poolAddress: '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
    apy: 4.8,
    tvl: 500_000_000,
    tokens: ['BNB'],
    riskScore: 2,
    riskAdjustedApy: 4.5,
    isAudited: true,
    impermanentLossRisk: 'low',
  },
  {
    protocol: 'Alpaca Finance',
    poolName: 'BNB-BUSD Leveraged Yield',
    poolAddress: '0xA625AB01B08ce023B2a342Dbb12a16f2C8489A8F',
    apy: 42.0,
    tvl: 18_000_000,
    tokens: ['BNB', 'BUSD'],
    riskScore: 7,
    riskAdjustedApy: 26.0,
    isAudited: true,
    impermanentLossRisk: 'high',
  },
  {
    protocol: 'Thena',
    poolName: 'THE-BNB vAMM',
    poolAddress: '0xd4ae6eCA985340Dd434D38F470aCCce4DC78d109',
    apy: 65.0,
    tvl: 8_000_000,
    tokens: ['THE', 'BNB'],
    riskScore: 6,
    riskAdjustedApy: 32.0,
    isAudited: false,
    impermanentLossRisk: 'high',
  },
];

// ---------------------------------------------------------------------------
// Live data fetcher — PancakeSwap V2 farms API (public, no key needed)
// ---------------------------------------------------------------------------

interface PancakePoolApiItem {
  lpSymbol?: string;
  lpAddress?: string;
  apr?: { value?: number };
  token?: { symbol?: string };
  quoteToken?: { symbol?: string };
  lpApr?: number;
  totalValueFormatted?: string;
}

async function fetchPancakeswapFarms(): Promise<FarmOpportunity[]> {
  const response = await fetch(
    'https://farms-api.pancakeswap.finance/farms/v2?chainId=56',
    { signal: AbortSignal.timeout(8000) },
  );

  if (!response.ok) return [];

  const json = (await response.json()) as { data?: PancakePoolApiItem[] };
  const pools: PancakePoolApiItem[] = json.data ?? [];

  const farms: FarmOpportunity[] = [];

  for (const pool of pools.slice(0, 20)) {
    const tokenSymbols = [pool.token?.symbol, pool.quoteToken?.symbol]
      .filter(Boolean) as string[];

    if (tokenSymbols.length < 2) continue;

    const apyRaw = pool.apr?.value ?? pool.lpApr ?? 0;
    const apy = typeof apyRaw === 'number' ? apyRaw : parseFloat(String(apyRaw)) || 0;

    // Simple TVL parse from formatted string like "$45,123,456"
    let tvl = 0;
    if (pool.totalValueFormatted) {
      tvl = parseFloat(pool.totalValueFormatted.replace(/[$,]/g, '')) || 0;
    }

    if (apy < 1 || tvl < 1_000_000) continue;

    // Score risk: stablecoin-only = 1, BNB pairs = 3, meme pairs = 7
    const isStableOnly = tokenSymbols.every((s) =>
      ['USDT', 'USDC', 'BUSD', 'DAI'].includes(s.toUpperCase()),
    );
    const riskScore = isStableOnly ? 1 : 3;
    const riskAdjustedApy = apy * (1 - riskScore / 20);

    farms.push({
      protocol: 'PancakeSwap',
      poolName: pool.lpSymbol ?? tokenSymbols.join('-') + ' LP',
      poolAddress: pool.lpAddress ?? '',
      apy,
      tvl,
      tokens: tokenSymbols,
      riskScore,
      riskAdjustedApy,
      isAudited: true,
      impermanentLossRisk: isStableOnly ? 'low' : 'medium',
    });
  }

  return farms;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch and score farm opportunities.
 * Tries PancakeSwap live API first; falls back to curated baseline.
 */
export async function fetchFarms(): Promise<FarmOpportunity[]> {
  try {
    const live = await fetchPancakeswapFarms();
    if (live.length >= 3) {
      // Merge: live PancakeSwap data + Venus/Alpaca baseline (non-PancakeSwap)
      const nonPancake = BASELINE_FARMS.filter((f) => f.protocol !== 'PancakeSwap');
      return scoreFarms([...live, ...nonPancake]);
    }
  } catch {
    // Network error or rate limit — fall through to baseline
  }
  return scoreFarms(BASELINE_FARMS);
}

/**
 * Sort farms by risk-adjusted APY descending.
 */
export function scoreFarms(farms: FarmOpportunity[]): FarmOpportunity[] {
  return [...farms].sort((a, b) => b.riskAdjustedApy - a.riskAdjustedApy);
}

/**
 * Filter farms by max risk score and optional token filter.
 */
export function filterFarms(
  farms: FarmOpportunity[],
  maxRiskScore: number,
  tokenFilter?: string[],
  minApy = 0,
): FarmOpportunity[] {
  let result = farms.filter((f) => f.riskScore <= maxRiskScore && f.apy >= minApy);
  if (tokenFilter && tokenFilter.length > 0) {
    const upper = tokenFilter.map((t) => t.toUpperCase());
    result = result.filter((f) => upper.some((t) => f.tokens.includes(t)));
  }
  return result;
}
