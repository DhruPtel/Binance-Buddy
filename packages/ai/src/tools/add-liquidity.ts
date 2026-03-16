// =============================================================================
// add_liquidity — Add PancakeSwap V2 liquidity via agent wallet
// Swaps half BNB for token, approves, addLiquidityETH.
// =============================================================================

import type { AgentTool, AgentContext } from '@binancebuddy/core';
import {
  resolveToken,
  BNB_FEE_RESERVE,
  MAX_SLIPPAGE_NORMAL_BPS,
  MAX_SLIPPAGE_TRENCHES_BPS,
} from '@binancebuddy/core';
import {
  createProvider,
  getBnbBalance,
  executeLPEntry,
  getOrCreateAgentWallet,
} from '@binancebuddy/blockchain';
import { fetchYieldPools } from '../data/defillama.js';

async function resolveViaDefiLlama(symbol: string): Promise<string | null> {
  try {
    const pools = await fetchYieldPools();
    const upper = symbol.toUpperCase();
    const match = pools.find(
      (p) => p.symbol.toUpperCase().includes(upper) && p.underlyingTokens?.length,
    );
    return match?.underlyingTokens?.[0] ?? null;
  } catch {
    return null;
  }
}

export const addLiquidityTool: AgentTool = {
  name: 'add_liquidity',
  description:
    'Add liquidity to a PancakeSwap V2 BNB/token pool. ' +
    'Automatically swaps half the BNB amount for the token, approves, and calls addLiquidityETH. ' +
    'Returns transaction hash and LP tokens received.',
  parameters: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description: 'Token symbol (e.g. "CAKE", "USDT") or contract address (0x...) for the other side of the BNB pair',
      },
      amountBnb: {
        type: 'string',
        description: 'Total BNB amount to use (half is swapped for the token). E.g. "0.1".',
      },
      tokenAddress: {
        type: 'string',
        description: 'Optional explicit token contract address. Overrides symbol lookup.',
      },
    },
    required: ['token', 'amountBnb'],
  },
  handler: async (params: Record<string, unknown>, context: AgentContext) => {
    const tokenRaw = String(params.token ?? '');
    const amountBnb = String(params.amountBnb ?? '0');
    const explicitAddr = params.tokenAddress ? String(params.tokenAddress) : null;

    // Resolve token address
    let tokenAddress = explicitAddr ?? resolveToken(tokenRaw);
    if (!tokenAddress) {
      tokenAddress = await resolveViaDefiLlama(tokenRaw);
    }
    if (!tokenAddress) {
      return { error: `Unknown token: ${tokenRaw}. Provide a contract address or use a known symbol.` };
    }

    const amount = parseFloat(amountBnb);
    if (isNaN(amount) || amount <= 0) {
      return { error: 'amountBnb must be a positive number.' };
    }

    // Get fresh BNB balance
    const provider = createProvider();
    const { wallet } = getOrCreateAgentWallet(provider);
    const signer = wallet.connect(provider);
    const signerAddress = await signer.getAddress();

    const bnbBal = await getBnbBalance(provider, signerAddress);
    const bnbFormatted = Number(bnbBal) / 1e18;
    const available = bnbFormatted - BNB_FEE_RESERVE;

    if (amount > available) {
      return {
        error: `Insufficient BNB. Have ${bnbFormatted.toFixed(4)} BNB, need ${amount} + ${BNB_FEE_RESERVE} gas reserve. Max usable: ${available.toFixed(4)} BNB.`,
      };
    }

    const slippageBps = context.mode === 'trenches'
      ? MAX_SLIPPAGE_TRENCHES_BPS
      : MAX_SLIPPAGE_NORMAL_BPS;
    const bnbPriceUsd = context.researchReport?.marketOverview.bnbPriceUsd ?? 600;

    try {
      const result = await executeLPEntry(
        provider,
        signer,
        tokenAddress,
        amountBnb,
        slippageBps,
        bnbPriceUsd,
      );

      return {
        status: result.success ? 'executed' : 'execution_failed',
        txHash: result.txHash,
        token: tokenRaw.toUpperCase(),
        tokenAddress,
        amountBnb,
        lpTokensReceived: result.lpTokensReceived,
        pairAddress: result.pairAddress,
        steps: result.steps.map((s) => ({ label: s.label, status: s.status, txHash: s.txHash })),
        gasUsed: result.gasUsed,
        error: result.error,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `LP entry failed: ${msg.slice(0, 200)}` };
    }
  },
};
