// =============================================================================
// find_farms — returns farm/yield opportunities from research report or defaults
// =============================================================================

import type { AgentTool, AgentContext, FarmOpportunity } from '@binancebuddy/core';

// Hardcoded known-good BSC farms as baseline (updated by research agent)
const BASELINE_FARMS: FarmOpportunity[] = [
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
];

export const findFarmsTool: AgentTool = {
  name: 'find_farms',
  description:
    'Find yield farming and liquidity providing opportunities on BSC. ' +
    'Returns farms sorted by risk-adjusted APY. ' +
    'Use the user risk score to filter: low risk (1-3) for conservative users, ' +
    'all farms for degens and trenches mode.',
  parameters: {
    type: 'object',
    properties: {
      maxRiskScore: {
        type: 'number',
        description: 'Filter farms by max risk score (1-10). Default: match user profile.',
      },
      tokens: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: only show farms containing these token symbols.',
      },
      minApy: {
        type: 'number',
        description: 'Minimum APY percentage. Default: 0.',
      },
    },
    required: [],
  },
  handler: async (params: Record<string, unknown>, context: AgentContext) => {
    // Prefer live data from research report
    const farms = context.researchReport?.opportunities ?? BASELINE_FARMS;

    const maxRisk = params.maxRiskScore != null
      ? Number(params.maxRiskScore)
      : context.userProfile.riskScore + 2; // allow slightly above user's tolerance
    const minApy = Number(params.minApy ?? 0);
    const filterTokens = Array.isArray(params.tokens)
      ? (params.tokens as string[]).map((t) => t.toUpperCase())
      : [];

    let filtered = farms.filter((f) => f.riskScore <= maxRisk && f.apy >= minApy);

    if (filterTokens.length > 0) {
      filtered = filtered.filter((f) =>
        filterTokens.some((t) => f.tokens.includes(t)),
      );
    }

    // Sort by risk-adjusted APY descending
    filtered.sort((a, b) => b.riskAdjustedApy - a.riskAdjustedApy);

    return {
      farms: filtered.slice(0, 5), // top 5
      totalFound: filtered.length,
      userRiskScore: context.userProfile.riskScore,
      dataSource: context.researchReport ? 'live_research' : 'baseline',
      lastUpdated: context.researchReport
        ? new Date(context.researchReport.timestamp).toISOString()
        : 'static',
    };
  },
};
