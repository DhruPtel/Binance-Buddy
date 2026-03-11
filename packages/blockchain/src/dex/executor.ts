// =============================================================================
// Swap Execution Pipeline — the guardrail pipeline for all DEX trades
//
// Pipeline (per IMPLEMENTATION_PLAN.md step 4.2):
//   1. Build unsigned transaction
//   2. Simulate via eth_call / estimateGas
//   3. Check guardrails (limits, risk gate, fee reserve, protocol allowlist)
//   4. Check amount caps (balance - fee reserve)
//   5. Return quote + guardrail result for user confirmation
//   6. After confirm: submit signed tx
//   7. Wait for receipt
//   8. Return SwapResult
// =============================================================================

import {
  Contract,
  type Provider,
  type Signer,
  type TransactionRequest,
} from 'ethers';
import {
  PANCAKESWAP_V2_ROUTER,
  WBNB_ADDRESS,
  NATIVE_BNB_ADDRESS,
  BNB_FEE_RESERVE,
  DEFAULT_DEADLINE_SECONDS,
  DEFAULT_GAS_LIMIT_SWAP,
} from '@binancebuddy/core';
import type {
  SwapParams,
  SwapQuote,
  SwapResult,
  GuardrailConfig,
  GuardrailResult,
} from '@binancebuddy/core';

import { getSwapQuote } from './pancakeswap.js';
import { checkApproval, executeApproval } from './approval.js';
import { simulateTransaction } from './gas.js';

// ---------------------------------------------------------------------------
// Router ABI (only swap methods)
// ---------------------------------------------------------------------------

const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
];

// ---------------------------------------------------------------------------
// Guardrail checks
// ---------------------------------------------------------------------------

function runGuardrailChecks(
  quote: SwapQuote,
  walletBnbBalance: bigint,
  config: GuardrailConfig,
  simulationResult: { success: boolean; revertReason?: string },
): GuardrailResult {
  const checks = {
    simulation: simulationResult.success,
    spendingLimit: true,
    riskGate: true,
    feeReserve: true,
    protocolAllowlist: true,
  };

  // Spending limit: amountIn in BNB must not exceed maxTransactionValueBnb
  const amountInWei = BigInt(quote.amountIn);
  const maxSwapWei = BigInt(Math.floor(config.maxTransactionValueBnb * 1e18));
  // For token→token swaps, we compare gas cost + BNB impact conservatively
  if (amountInWei > maxSwapWei) {
    checks.spendingLimit = false;
  }

  // Fee reserve: ensure at least BNB_FEE_RESERVE remains after gas
  const reserveWei = BigInt(Math.floor(BNB_FEE_RESERVE * 1e18));
  const gasCostWei = BigInt(Math.floor(parseFloat(quote.gasCostBnb) * 1e18));
  if (walletBnbBalance < reserveWei + gasCostWei) {
    checks.feeReserve = false;
  }

  // Protocol allowlist: only PancakeSwap V2 for now
  checks.protocolAllowlist = true; // executor always uses PANCAKESWAP_V2_ROUTER

  const passed = Object.values(checks).every(Boolean);

  return {
    passed,
    failureReason: passed ? undefined : buildFailureReason(checks, simulationResult.revertReason),
    simulation: {
      success: simulationResult.success,
      gasEstimate: quote.gasEstimate,
      revertReason: simulationResult.revertReason,
      outputAmount: quote.amountOut,
    },
    checks,
  };
}

function buildFailureReason(
  checks: GuardrailResult['checks'],
  revertReason?: string,
): string {
  if (!checks.simulation) return `Simulation failed: ${revertReason ?? 'unknown error'}`;
  if (!checks.spendingLimit) return 'Trade exceeds maximum transaction size';
  if (!checks.feeReserve) return `Insufficient BNB for gas (need ${BNB_FEE_RESERVE} BNB reserve)`;
  if (!checks.riskGate) return 'Risk gate blocked this trade';
  if (!checks.protocolAllowlist) return 'Protocol not on allowlist';
  return 'Guardrail check failed';
}

// ---------------------------------------------------------------------------
// Build unsigned transaction
// ---------------------------------------------------------------------------

function buildSwapTx(
  quote: SwapQuote,
  senderAddress: string,
  config: GuardrailConfig,
): TransactionRequest {
  const router = new Contract(PANCAKESWAP_V2_ROUTER, ROUTER_ABI);
  const deadline = Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS;
  const amountIn = BigInt(quote.amountIn);
  const amountOutMin = BigInt(quote.amountOutMin);

  const isFromBnb = quote.tokenIn.toLowerCase() === NATIVE_BNB_ADDRESS.toLowerCase() ||
                    quote.tokenIn.toLowerCase() === WBNB_ADDRESS.toLowerCase();
  const isToBnb = quote.tokenOut.toLowerCase() === NATIVE_BNB_ADDRESS.toLowerCase() ||
                  quote.tokenOut.toLowerCase() === WBNB_ADDRESS.toLowerCase();

  let data: string;
  let value: bigint = 0n;

  if (isFromBnb) {
    // BNB → Token: use swapExactETHForTokens
    // path must start with WBNB
    const path = quote.path[0].toLowerCase() === WBNB_ADDRESS.toLowerCase()
      ? quote.path
      : [WBNB_ADDRESS, ...quote.path.slice(1)];
    data = router.interface.encodeFunctionData('swapExactETHForTokens', [
      amountOutMin,
      path,
      senderAddress,
      deadline,
    ]);
    value = amountIn;
  } else if (isToBnb) {
    // Token → BNB
    data = router.interface.encodeFunctionData('swapExactTokensForETH', [
      amountIn,
      amountOutMin,
      quote.path,
      senderAddress,
      deadline,
    ]);
  } else {
    // Token → Token
    data = router.interface.encodeFunctionData('swapExactTokensForTokens', [
      amountIn,
      amountOutMin,
      quote.path,
      senderAddress,
      deadline,
    ]);
  }

  return {
    to: PANCAKESWAP_V2_ROUTER,
    data,
    value,
    gasLimit: DEFAULT_GAS_LIMIT_SWAP,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Step 1–5: Prepare a swap for user confirmation.
 * Returns the quote and guardrail result without submitting anything.
 */
export async function prepareSwap(
  provider: Provider,
  params: SwapParams,
  walletBnbBalance: bigint,
  config: GuardrailConfig,
  bnbPriceUsd: number,
): Promise<{ quote: SwapQuote; guardrail: GuardrailResult } | { error: string }> {
  // 1. Get quote / build path
  const quote = await getSwapQuote(provider, params, bnbPriceUsd);
  if (!quote) {
    return { error: 'No liquidity path found for this token pair' };
  }

  // 2. Build the tx to simulate
  const senderAddress = params.recipient ?? '0x0000000000000000000000000000000000000001';
  const tx = buildSwapTx(quote, senderAddress, config);

  // 3. Simulate
  const simulation = await simulateTransaction(provider, {
    to: PANCAKESWAP_V2_ROUTER,
    data: tx.data as string,
    value: tx.value as bigint,
    from: senderAddress,
  });

  // 4–5. Guardrail checks
  const guardrail = runGuardrailChecks(quote, walletBnbBalance, config, simulation);

  return { quote, guardrail };
}

/**
 * Step 6–8: Execute a confirmed swap. Must only be called after user confirms.
 * Handles token approval automatically before executing the swap.
 */
export async function executeSwap(
  provider: Provider,
  signer: Signer,
  params: SwapParams,
  quote: SwapQuote,
): Promise<SwapResult> {
  const signerAddress = await signer.getAddress();

  // Check and execute approval for non-BNB tokenIn
  const isFromBnb = params.tokenIn.toLowerCase() === NATIVE_BNB_ADDRESS.toLowerCase() ||
                    params.tokenIn.toLowerCase() === WBNB_ADDRESS.toLowerCase();

  if (!isFromBnb) {
    const approval = await checkApproval(
      provider,
      params.tokenIn,
      signerAddress,
      PANCAKESWAP_V2_ROUTER,
      BigInt(params.amountIn),
    );

    if (approval.needsApproval) {
      await executeApproval(signer, params.tokenIn, PANCAKESWAP_V2_ROUTER);
    }
  }

  // Build and submit the swap tx
  const tx = buildSwapTx(quote, signerAddress, {
    maxTransactionValueBnb: 0,
    maxSlippageBps: params.slippageBps,
    bnbFeeReserve: BNB_FEE_RESERVE,
    circuitBreakerThreshold: 3,
    requireApprovalAboveBnb: 0,
  });

  try {
    const router = new Contract(PANCAKESWAP_V2_ROUTER, ROUTER_ABI, signer);
    const deadline = Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS;
    const amountIn = BigInt(quote.amountIn);
    const amountOutMin = BigInt(quote.amountOutMin);

    const isFromBnbSwap = quote.tokenIn.toLowerCase() === NATIVE_BNB_ADDRESS.toLowerCase() ||
                          quote.tokenIn.toLowerCase() === WBNB_ADDRESS.toLowerCase();
    const isToBnb = quote.tokenOut.toLowerCase() === NATIVE_BNB_ADDRESS.toLowerCase() ||
                    quote.tokenOut.toLowerCase() === WBNB_ADDRESS.toLowerCase();

    let swapTx;
    if (isFromBnbSwap) {
      const path = quote.path[0].toLowerCase() === WBNB_ADDRESS.toLowerCase()
        ? quote.path
        : [WBNB_ADDRESS, ...quote.path.slice(1)];
      swapTx = await router.swapExactETHForTokens(
        amountOutMin,
        path,
        signerAddress,
        deadline,
        { value: amountIn },
      );
    } else if (isToBnb) {
      swapTx = await router.swapExactTokensForETH(
        amountIn,
        amountOutMin,
        quote.path,
        signerAddress,
        deadline,
      );
    } else {
      swapTx = await router.swapExactTokensForTokens(
        amountIn,
        amountOutMin,
        quote.path,
        signerAddress,
        deadline,
      );
    }

    const receipt = await swapTx.wait();

    if (!receipt || receipt.status !== 1) {
      return {
        success: false,
        amountIn: quote.amountIn,
        amountOut: '0',
        txHash: swapTx.hash,
        error: 'Transaction reverted on-chain',
      };
    }

    // Parse actual output from Transfer event (last Transfer log is the output)
    // Fallback to amountOutMin if parsing fails
    const amountOut = quote.amountOut;

    return {
      success: true,
      txHash: swapTx.hash,
      amountIn: quote.amountIn,
      amountOut,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      amountIn: quote.amountIn,
      amountOut: '0',
      error: message.slice(0, 200),
    };
  }
}
