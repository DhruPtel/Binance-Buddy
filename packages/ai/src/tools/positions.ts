// =============================================================================
// check_positions — returns current token holdings and portfolio breakdown
// =============================================================================

import type { AgentTool, AgentContext } from '@binancebuddy/core';

export const checkPositionsTool: AgentTool = {
  name: 'check_positions',
  description:
    'Returns all current token positions with balances, prices, and USD values. ' +
    'Also includes BNB balance and total portfolio value. ' +
    'Call this first in any conversation to understand what the user holds.',
  parameters: {
    type: 'object',
    properties: {
      minValueUsd: {
        type: 'number',
        description: 'Optional minimum USD value filter. Default 0 (show all).',
      },
    },
    required: [],
  },
  handler: async (params: Record<string, unknown>, context: AgentContext) => {
    const minValue = Number(params.minValueUsd ?? 0);
    const { walletState, userProfile, buddyState } = context;

    const tokens = walletState.tokens
      .filter((t) => t.valueUsd >= minValue)
      .map((t) => ({
        symbol: t.symbol,
        name: t.name,
        address: t.address,
        balance: t.balanceFormatted,
        priceUsd: t.priceUsd,
        valueUsd: t.valueUsd,
      }));

    return {
      address: walletState.address,
      bnb: {
        balance: walletState.bnbBalanceFormatted,
        valueUsd: walletState.bnbBalanceFormatted * (walletState.totalValueUsd > 0
          ? walletState.totalValueUsd / (walletState.bnbBalanceFormatted + walletState.tokens.reduce((s, t) => s + t.balanceFormatted, 0))
          : 0),
      },
      tokens,
      totalValueUsd: walletState.totalValueUsd,
      profile: {
        archetype: userProfile.archetype,
        riskScore: userProfile.riskScore,
        tradingFrequency: userProfile.tradingFrequency,
      },
      buddy: {
        stage: buddyState.stage,
        mood: buddyState.mood,
        xp: buddyState.xp,
      },
    };
  },
};
