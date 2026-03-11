// =============================================================================
// swap_tokens — real PancakeSwap V2 quote via prepareSwap()
// Returns quote + guardrail result for user confirmation.
// Does NOT execute — execution requires explicit user confirm.
// =============================================================================

import { parseUnits } from 'ethers';
import type { AgentTool, AgentContext } from '@binancebuddy/core';
import {
  SAFE_TOKENS,
  NATIVE_BNB_ADDRESS,
  WBNB_ADDRESS,
  BNB_FEE_RESERVE,
  MAX_SLIPPAGE_NORMAL_BPS,
  MAX_SLIPPAGE_TRENCHES_BPS,
} from '@binancebuddy/core';
import { createProvider, prepareSwap } from '@binancebuddy/blockchain';

// All BSC tokens (including SAFE_TOKENS) use 18 decimals
const TOKEN_DECIMALS = 18;

export const swapTokensTool: AgentTool = {
  name: 'swap_tokens',
  description:
    'Get a real PancakeSwap V2 quote for swapping one token to another. ' +
    'Returns the quote and guardrail check result for user confirmation — ' +
    'does NOT execute automatically. Always show the quote and wait for explicit ' +
    'user confirmation before proceeding with execution.',
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
    const tokenInRaw = String(params.tokenIn ?? '');
    const tokenOutRaw = String(params.tokenOut ?? '');
    const amountInDecimal = String(params.amountIn ?? '0');
    const maxSlippage = context.mode === 'trenches'
      ? MAX_SLIPPAGE_TRENCHES_BPS
      : MAX_SLIPPAGE_NORMAL_BPS;
    const slippageBps = Math.min(Number(params.slippageBps ?? 100), maxSlippage);

    // Resolve symbol → address (BNB special-cased to WBNB for router, native for value)
    const resolveAddress = (symbolOrAddr: string): string | null => {
      if (symbolOrAddr.startsWith('0x')) return symbolOrAddr;
      const upper = symbolOrAddr.toUpperCase();
      if (upper === 'BNB') return NATIVE_BNB_ADDRESS;
      return SAFE_TOKENS[upper] ?? null;
    };

    const inAddr = resolveAddress(tokenInRaw);
    const outAddr = resolveAddress(tokenOutRaw);

    if (!inAddr) {
      return { error: `Unknown token: ${tokenInRaw}. Use a contract address or a known symbol (BNB, WBNB, CAKE, USDT, USDC, BUSD, ETH, BTCB).` };
    }
    if (!outAddr) {
      return { error: `Unknown token: ${tokenOutRaw}. Use a contract address or a known symbol.` };
    }

    const amount = parseFloat(amountInDecimal);
    if (isNaN(amount) || amount <= 0) {
      return { error: 'amountIn must be a positive number.' };
    }

    // Guardrail: fee reserve check for BNB sells
    const isBnbIn = tokenInRaw.toUpperCase() === 'BNB' || tokenInRaw.toUpperCase() === 'WBNB';
    if (isBnbIn) {
      const available = context.walletState.bnbBalanceFormatted - BNB_FEE_RESERVE;
      if (amount > available) {
        return {
          error: `Amount exceeds safe limit. You have ${context.walletState.bnbBalanceFormatted.toFixed(4)} BNB but must keep ${BNB_FEE_RESERVE} BNB for gas. Max sellable: ${available.toFixed(4)} BNB.`,
        };
      }
    }

    // Convert to bigint (all BSC tokens use 18 decimals)
    let amountInWei: bigint;
    try {
      amountInWei = parseUnits(amountInDecimal, TOKEN_DECIMALS);
    } catch {
      return { error: `Invalid amount: ${amountInDecimal}` };
    }

    // Use WBNB address for router path when input is native BNB
    const routerTokenIn = inAddr === NATIVE_BNB_ADDRESS ? WBNB_ADDRESS : inAddr;
    const routerTokenOut = outAddr === NATIVE_BNB_ADDRESS ? WBNB_ADDRESS : outAddr;

    const bnbPriceUsd = context.researchReport?.marketOverview.bnbPriceUsd ?? 600;

    try {
      const provider = createProvider();

      const result = await prepareSwap(
        provider,
        {
          tokenIn: routerTokenIn,
          tokenOut: routerTokenOut,
          amountIn: amountInWei.toString(),
          slippageBps,
          recipient: context.walletState.address,
        },
        BigInt(context.walletState.bnbBalance),
        context.guardrailConfig,
        bnbPriceUsd,
      );

      if ('error' in result) {
        return { error: result.error };
      }

      const { quote, guardrail } = result;

      // Format amounts for display (assume 18 decimals)
      const amountOutFormatted = (Number(BigInt(quote.amountOut)) / 1e18).toFixed(6);
      const amountOutMinFormatted = (Number(BigInt(quote.amountOutMin)) / 1e18).toFixed(6);

      return {
        status: guardrail.passed ? 'quote_ready' : 'guardrail_blocked',
        tokenIn: { symbol: tokenInRaw.toUpperCase(), address: inAddr },
        tokenOut: { symbol: tokenOutRaw.toUpperCase(), address: outAddr },
        amountIn: amountInDecimal,
        amountOut: amountOutFormatted,
        amountOutMin: amountOutMinFormatted,
        slippageBps,
        priceImpact: quote.priceImpact,
        path: quote.path,
        gasCostBnb: quote.gasCostBnb,
        gasCostUsd: quote.gasCostUsd.toFixed(2),
        guardrail: {
          passed: guardrail.passed,
          failureReason: guardrail.failureReason,
          checks: guardrail.checks,
        },
        requiresConfirmation: guardrail.passed,
        mode: context.mode,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Quote failed: ${msg.slice(0, 200)}` };
    }
  },
};
