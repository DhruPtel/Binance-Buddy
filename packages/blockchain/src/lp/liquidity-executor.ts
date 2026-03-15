// =============================================================================
// LP Executor — add liquidity to PancakeSwap V2 pools
//
// BNB + Token flow:
//   1. Swap half BNB for token (via existing swap engine)
//   2. Approve token for PancakeSwap Router
//   3. addLiquidityETH with ACTUAL swap output (not quote estimate)
//   4. Return tx hash + LP tokens received
//
// Uses block.timestamp + 300 for deadline (chain time, not local clock).
// =============================================================================

import { Contract, type Provider, type Signer } from 'ethers';
import {
  PANCAKESWAP_V2_ROUTER,
  PANCAKESWAP_V2_FACTORY,
  WBNB_ADDRESS,
  NATIVE_BNB_ADDRESS,
} from '@binancebuddy/core';
import { ERC20_ABI, PANCAKESWAP_ROUTER_LP_ABI, PANCAKESWAP_PAIR_ABI, PANCAKESWAP_FACTORY_ABI } from '../abis.js';
import { checkApproval, executeApproval } from '../dex/approval.js';
import { prepareSwap, executeSwap } from '../dex/executor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LPExecutionStep {
  label: string;
  status: 'pending' | 'executing' | 'confirmed' | 'failed';
  txHash?: string;
}

export interface LPExecutionResult {
  success: boolean;
  steps: LPExecutionStep[];
  lpTokensReceived?: string;
  pairAddress?: string;
  txHash?: string;
  gasUsed?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getChainDeadline(provider: Provider): Promise<number> {
  const block = await provider.getBlock('latest');
  return block!.timestamp + 300;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add BNB + Token liquidity to PancakeSwap V2.
 * Swaps half of amountBnb for the token, then calls addLiquidityETH.
 */
export async function executeLPEntry(
  provider: Provider,
  signer: Signer,
  tokenAddress: string,
  amountBnb: string,
  slippageBps: number,
  bnbPriceUsd: number,
): Promise<LPExecutionResult> {
  const signerAddress = await signer.getAddress();
  const totalBnbWei = BigInt(Math.floor(parseFloat(amountBnb) * 1e18));
  const halfBnbWei = totalBnbWei / 2n;

  const steps: LPExecutionStep[] = [
    { label: 'Swap half BNB for token', status: 'pending' },
    { label: 'Approve token for Router', status: 'pending' },
    { label: 'Add liquidity', status: 'pending' },
  ];

  const fail = (stepIdx: number, error: string): LPExecutionResult => {
    steps[stepIdx].status = 'failed';
    return { success: false, steps, error };
  };

  try {
    // -----------------------------------------------------------------------
    // Step 1: Swap half BNB for the token
    // -----------------------------------------------------------------------
    steps[0].status = 'executing';

    const swapParams = {
      tokenIn: WBNB_ADDRESS,
      tokenOut: tokenAddress,
      amountIn: halfBnbWei.toString(),
      slippageBps,
      recipient: signerAddress,
    };

    // Guardrail config for the internal swap — use generous limits
    const guardrailConfig = {
      maxTransactionValueBnb: 100,
      maxSlippageBps: slippageBps,
      bnbFeeReserve: 0.005,
      circuitBreakerThreshold: 3,
      requireApprovalAboveBnb: 0,
    };

    const prepared = await prepareSwap(
      provider,
      swapParams,
      totalBnbWei,
      guardrailConfig,
      bnbPriceUsd,
    );

    if ('error' in prepared) {
      return fail(0, `Quote failed: ${prepared.error}`);
    }
    if (!prepared.guardrail.passed) {
      return fail(0, `Guardrail blocked: ${prepared.guardrail.failureReason}`);
    }

    const swapResult = await executeSwap(provider, signer, swapParams, prepared.quote);
    if (!swapResult.success) {
      return fail(0, `Swap failed: ${swapResult.error}`);
    }

    steps[0].status = 'confirmed';
    steps[0].txHash = swapResult.txHash;

    // ACTUAL token amount received (parsed from Transfer events, not estimate)
    const tokenAmountReceived = BigInt(swapResult.amountOut);

    // -----------------------------------------------------------------------
    // Step 2: Approve token for Router
    // -----------------------------------------------------------------------
    steps[1].status = 'executing';

    const approval = await checkApproval(
      provider,
      tokenAddress,
      signerAddress,
      PANCAKESWAP_V2_ROUTER,
      tokenAmountReceived,
    );

    if (approval.needsApproval) {
      const approveTxHash = await executeApproval(signer, tokenAddress, PANCAKESWAP_V2_ROUTER);
      steps[1].txHash = approveTxHash;
    }
    steps[1].status = 'confirmed';

    // -----------------------------------------------------------------------
    // Step 3: addLiquidityETH
    // -----------------------------------------------------------------------
    steps[2].status = 'executing';

    const router = new Contract(PANCAKESWAP_V2_ROUTER, PANCAKESWAP_ROUTER_LP_ABI, signer);
    const deadline = await getChainDeadline(provider);

    // Slippage on both sides
    const slippageFactor = 10_000n - BigInt(slippageBps);
    const amountTokenMin = (tokenAmountReceived * slippageFactor) / 10_000n;
    const amountBnbMin = (halfBnbWei * slippageFactor) / 10_000n;

    // Get LP token balance before
    const factory = new Contract(PANCAKESWAP_V2_FACTORY, PANCAKESWAP_FACTORY_ABI, provider);
    const pairAddress: string = await factory.getPair(tokenAddress, WBNB_ADDRESS);
    let lpBefore = 0n;
    if (pairAddress !== '0x0000000000000000000000000000000000000000') {
      const pair = new Contract(pairAddress, PANCAKESWAP_PAIR_ABI, provider);
      lpBefore = await pair.balanceOf(signerAddress) as bigint;
    }

    const tx = await router.addLiquidityETH(
      tokenAddress,
      tokenAmountReceived,
      amountTokenMin,
      amountBnbMin,
      signerAddress,
      deadline,
      { value: halfBnbWei },
    );

    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      steps[2].txHash = tx.hash;
      return fail(2, 'addLiquidityETH reverted on-chain');
    }

    steps[2].status = 'confirmed';
    steps[2].txHash = tx.hash;

    // Calculate LP tokens received
    let lpReceived = '0';
    if (pairAddress !== '0x0000000000000000000000000000000000000000') {
      const pair = new Contract(pairAddress, PANCAKESWAP_PAIR_ABI, provider);
      const lpAfter: bigint = await pair.balanceOf(signerAddress);
      lpReceived = (lpAfter - lpBefore).toString();
    }

    return {
      success: true,
      steps,
      lpTokensReceived: lpReceived,
      pairAddress,
      txHash: tx.hash,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Mark the first non-confirmed step as failed
    const failIdx = steps.findIndex((s) => s.status !== 'confirmed');
    if (failIdx >= 0) steps[failIdx].status = 'failed';
    return { success: false, steps, error: message.slice(0, 200) };
  }
}
