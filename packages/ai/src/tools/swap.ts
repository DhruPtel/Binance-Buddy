// =============================================================================
// swap_tokens — builds a swap quote and returns it for user confirmation
// Real execution wired in Day 4 (DEX trading engine).
// =============================================================================

import type { AgentTool, AgentContext } from '@binancebuddy/core';
import { SAFE_TOKENS, BNB_FEE_RESERVE, MAX_SLIPPAGE_NORMAL_BPS, MAX_SLIPPAGE_TRENCHES_BPS } from '@binancebuddy/core';

export const swapTokensTool: AgentTool = {
  name: 'swap_tokens',
  description:
    'Build a swap quote between two tokens on PancakeSwap. Returns the quote details ' +
    'for user confirmation — does NOT execute automatically. ' +
    'Always show the quote to the user and wait for explicit confirm before calling execute.',
  parameters: {
    type: 'object',
    properties: {
      tokenIn: {
        type: 'string',
        description: 'Symbol or contract address of the token to sell (e.g. "BNB", "CAKE", "0x...")',
      },
      tokenOut: {
        type: 'string',
        description: 'Symbol or contract address of the token to buy (e.g. "USDT", "CAKE")',
      },
      amountIn: {
        type: 'string',
        description: 'Amount of tokenIn to sell as a decimal string (e.g. "0.1" for 0.1 BNB)',
      },
      slippageBps: {
        type: 'number',
        description: 'Slippage tolerance in basis points. Normal mode max: 100 (1%). Trenches max: 1500 (15%).',
      },
    },
    required: ['tokenIn', 'tokenOut', 'amountIn'],
  },
  handler: async (params: Record<string, unknown>, context: AgentContext) => {
    const tokenIn = String(params.tokenIn ?? '');
    const tokenOut = String(params.tokenOut ?? '');
    const amountIn = String(params.amountIn ?? '0');
    const maxSlippage = context.mode === 'trenches'
      ? MAX_SLIPPAGE_TRENCHES_BPS
      : MAX_SLIPPAGE_NORMAL_BPS;
    const slippageBps = Math.min(
      Number(params.slippageBps ?? 100),
      maxSlippage,
    );

    // Resolve symbol → address
    const resolveAddress = (symbolOrAddr: string): string | null => {
      if (symbolOrAddr.startsWith('0x')) return symbolOrAddr;
      const upper = symbolOrAddr.toUpperCase();
      return SAFE_TOKENS[upper] ?? null;
    };

    const inAddr = resolveAddress(tokenIn);
    const outAddr = resolveAddress(tokenOut);

    if (!inAddr) return { error: `Unknown token: ${tokenIn}. Use a contract address or a known symbol.` };
    if (!outAddr) return { error: `Unknown token: ${tokenOut}. Use a contract address or a known symbol.` };

    const amount = parseFloat(amountIn);
    if (isNaN(amount) || amount <= 0) return { error: 'amountIn must be a positive number.' };

    // Guardrail: fee reserve check (for BNB sells)
    if (tokenIn.toUpperCase() === 'BNB' || tokenIn.toUpperCase() === 'WBNB') {
      const available = context.walletState.bnbBalanceFormatted - BNB_FEE_RESERVE;
      if (amount > available) {
        return {
          error: `Amount exceeds safe limit. You have ${context.walletState.bnbBalanceFormatted.toFixed(4)} BNB but must keep ${BNB_FEE_RESERVE} BNB for gas. Max sellable: ${available.toFixed(4)} BNB.`,
        };
      }
    }

    // Stub: real quote will come from PancakeSwap in Day 4
    return {
      status: 'quote_ready',
      tokenIn: { symbol: tokenIn.toUpperCase(), address: inAddr },
      tokenOut: { symbol: tokenOut.toUpperCase(), address: outAddr },
      amountIn,
      amountOut: 'pending_execution_engine', // Day 4: real quote
      slippageBps,
      priceImpact: null,
      gasEstimateBnb: '0.0005',
      note: 'Quote engine not yet connected (Day 4). This shows the validated intent.',
      requiresConfirmation: true,
      mode: context.mode,
    };
  },
};
