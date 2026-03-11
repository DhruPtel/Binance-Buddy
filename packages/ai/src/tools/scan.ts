// =============================================================================
// scan_wallet — returns current wallet state from agent context
// =============================================================================

import type { AgentTool, AgentContext } from '@binancebuddy/core';

export const scanWalletTool: AgentTool = {
  name: 'scan_wallet',
  description:
    'Returns the current wallet balance, all token holdings with USD values, and the user profile. ' +
    'Use this to get a snapshot of what the user holds before making recommendations.',
  parameters: {
    type: 'object',
    properties: {
      refresh: {
        type: 'boolean',
        description: 'If true, note that data may be up to 60 seconds cached.',
      },
    },
    required: [],
  },
  handler: async (_params: Record<string, unknown>, context: AgentContext) => {
    const { walletState, userProfile } = context;

    return {
      address: walletState.address,
      bnbBalance: walletState.bnbBalanceFormatted,
      totalValueUsd: walletState.totalValueUsd,
      tokens: walletState.tokens.map((t) => ({
        symbol: t.symbol,
        balance: t.balanceFormatted,
        priceUsd: t.priceUsd,
        valueUsd: t.valueUsd,
      })),
      profile: {
        archetype: userProfile.archetype,
        riskScore: userProfile.riskScore,
        tradingFrequency: userProfile.tradingFrequency,
        totalTxCount: userProfile.totalTxCount,
      },
      lastScanned: new Date(walletState.lastScanned).toISOString(),
    };
  },
};
