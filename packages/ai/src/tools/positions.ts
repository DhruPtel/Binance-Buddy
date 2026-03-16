// =============================================================================
// check_positions — returns current token holdings and portfolio breakdown
// Does a FRESH on-chain scan (not stale context) + GoldRush for all BEP-20s.
// =============================================================================

import type { AgentTool, AgentContext, TokenInfo } from '@binancebuddy/core';
import {
  createProvider,
  scanWallet,
  getBnbBalance,
} from '@binancebuddy/blockchain';
import { getTokenBalances } from '../data/goldrush.js';

export const checkPositionsTool: AgentTool = {
  name: 'check_positions',
  description:
    'Returns all current token positions with balances, prices, and USD values. ' +
    'Scans ALL BEP-20 tokens the wallet holds (not just known tokens). ' +
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
    const { userProfile, buddyState } = context;
    const address = context.walletState.address;

    // Fresh on-chain scan for SAFE_TOKENS (BNB + known tokens with prices)
    const provider = createProvider();
    const freshWallet = await scanWallet(
      provider,
      address,
      process.env.COINGECKO_API_KEY || undefined,
    );

    // GoldRush scan for ALL BEP-20 holdings (vTokens, LP tokens, etc.)
    const goldRushTokens = await getTokenBalances('bsc-mainnet', address);

    // Merge: start with scanWallet results, add GoldRush tokens not already present
    const knownAddresses = new Set(
      freshWallet.tokens.map((t) => t.address.toLowerCase()),
    );

    const extraTokens: TokenInfo[] = [];
    for (const gt of goldRushTokens) {
      if (!gt.address || gt.address === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') continue;
      if (knownAddresses.has(gt.address.toLowerCase())) continue;

      const rawBal = BigInt(gt.balance || '0');
      if (rawBal === 0n) continue;

      const balanceFormatted = Number(rawBal) / 10 ** gt.decimals;
      extraTokens.push({
        address: gt.address,
        symbol: gt.symbol || 'UNKNOWN',
        name: gt.symbol || 'Unknown Token',
        decimals: gt.decimals,
        balance: gt.balance,
        balanceFormatted,
        priceUsd: gt.priceUsd,
        valueUsd: gt.valueUsd,
        logoUrl: undefined,
      });
    }

    const allTokens = [...freshWallet.tokens, ...extraTokens]
      .filter((t) => t.valueUsd >= minValue || t.balanceFormatted > 0)
      .sort((a, b) => b.valueUsd - a.valueUsd);

    const totalValueUsd = freshWallet.totalValueUsd +
      extraTokens.reduce((s, t) => s + t.valueUsd, 0);

    const tokens = allTokens.map((t) => ({
      symbol: t.symbol,
      name: t.name,
      address: t.address,
      balance: t.balanceFormatted,
      priceUsd: t.priceUsd,
      valueUsd: t.valueUsd,
    }));

    return {
      address,
      bnb: {
        balance: freshWallet.bnbBalanceFormatted,
        valueUsd: freshWallet.bnbBalanceFormatted * (freshWallet.totalValueUsd > 0
          ? freshWallet.totalValueUsd / (freshWallet.bnbBalanceFormatted + freshWallet.tokens.reduce((s, t) => s + t.balanceFormatted, 0) || 1)
          : 0),
      },
      tokens,
      totalValueUsd,
      tokenCount: tokens.length,
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
