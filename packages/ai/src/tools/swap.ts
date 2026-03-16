// =============================================================================
// swap_tokens — PancakeSwap V2 swap via agent wallet
// Pipeline: quote → guardrails → execute → return tx hash
// =============================================================================

import { parseUnits } from 'ethers';
import type { AgentTool, AgentContext } from '@binancebuddy/core';
import {
  resolveToken,
  NATIVE_BNB_ADDRESS,
  WBNB_ADDRESS,
  BNB_FEE_RESERVE,
  MAX_SLIPPAGE_NORMAL_BPS,
  MAX_SLIPPAGE_TRENCHES_BPS,
} from '@binancebuddy/core';
import {
  createProvider,
  prepareSwap,
  executeSwap,
  getOrCreateAgentWallet,
} from '@binancebuddy/blockchain';

// All BSC tokens (including SAFE_TOKENS) use 18 decimals
const TOKEN_DECIMALS = 18;

export const swapTokensTool: AgentTool = {
  name: 'swap_tokens',
  description:
    'Execute a PancakeSwap V2 token swap using the agent wallet. ' +
    'Gets a quote, runs guardrail checks (simulation, spending limit, fee reserve), ' +
    'and if all checks pass, executes the swap immediately and returns the transaction hash.',
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

    const inAddr = resolveToken(tokenInRaw);
    const outAddr = resolveToken(tokenOutRaw);

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

      const swapParams = {
        tokenIn: routerTokenIn,
        tokenOut: routerTokenOut,
        amountIn: amountInWei.toString(),
        slippageBps,
        recipient: context.walletState.address,
      };

      const result = await prepareSwap(
        provider,
        swapParams,
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

      // If guardrails failed, return the quote with the failure reason
      if (!guardrail.passed) {
        return {
          status: 'guardrail_blocked',
          tokenIn: { symbol: tokenInRaw.toUpperCase(), address: inAddr },
          tokenOut: { symbol: tokenOutRaw.toUpperCase(), address: outAddr },
          amountIn: amountInDecimal,
          amountOut: amountOutFormatted,
          amountOutMin: amountOutMinFormatted,
          slippageBps,
          priceImpact: quote.priceImpact,
          guardrail: {
            passed: false,
            failureReason: guardrail.failureReason,
            checks: guardrail.checks,
          },
          mode: context.mode,
        };
      }

      // Guardrails passed — execute the swap with the agent wallet
      const { wallet } = getOrCreateAgentWallet(provider);
      const signer = wallet.connect(provider);

      const swapResult = await executeSwap(provider, signer, swapParams, quote);

      return {
        status: swapResult.success ? 'executed' : 'execution_failed',
        txHash: swapResult.txHash,
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
        gasUsed: swapResult.gasUsed,
        guardrail: {
          passed: true,
          checks: guardrail.checks,
        },
        error: swapResult.error,
        mode: context.mode,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Swap failed: ${msg.slice(0, 200)}` };
    }
  },
};
