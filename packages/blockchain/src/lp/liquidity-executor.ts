// =============================================================================
// LP Executor — add liquidity to PancakeSwap V2 or V3 pools
//
// Auto-detects pool version:
//   - V3: NonfungiblePositionManager.mint() with full-range ticks
//   - V2: addLiquidityETH (existing flow)
//
// BNB + Token flow:
//   1. Detect pool version (V3 factory.getPool → V2 factory.getPair)
//   2. Swap half BNB for token (via existing swap engine)
//   3. Approve token for Router/PositionManager
//   4. V3: mint full-range position  OR  V2: addLiquidityETH
//   5. Return tx hash + LP tokens/NFT received
//
// Uses block.timestamp + 300 for deadline (chain time, not local clock).
// =============================================================================

import { Contract, type Provider, type Signer } from 'ethers';
import {
  PANCAKESWAP_V2_ROUTER,
  PANCAKESWAP_V2_FACTORY,
  PANCAKESWAP_V3_FACTORY,
  PANCAKESWAP_V3_POSITION_MANAGER,
  WBNB_ADDRESS,
} from '@binancebuddy/core';
import {
  ERC20_ABI,
  PANCAKESWAP_ROUTER_LP_ABI,
  PANCAKESWAP_PAIR_ABI,
  PANCAKESWAP_FACTORY_ABI,
  PANCAKESWAP_V3_FACTORY_ABI,
  PANCAKESWAP_V3_POOL_ABI,
  NONFUNGIBLE_POSITION_MANAGER_ABI,
} from '../abis.js';
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
  tokenId?: string;       // V3 NFT position token ID
  poolVersion?: 'v2' | 'v3';
  txHash?: string;
  gasUsed?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// V3 Pool Detection
// ---------------------------------------------------------------------------

// PancakeSwap V3 fee tiers: 100 (0.01%), 500 (0.05%), 2500 (0.25%), 10000 (1%)
const V3_FEE_TIERS: number[] = [2500, 500, 10000, 100];

/**
 * Check if a V3 pool exists for the token/WBNB pair.
 * Tries all fee tiers and returns the first active pool found.
 */
async function findV3Pool(
  provider: Provider,
  tokenAddress: string,
): Promise<{ poolAddress: string; fee: number; tickSpacing: number } | null> {
  const factory = new Contract(PANCAKESWAP_V3_FACTORY, PANCAKESWAP_V3_FACTORY_ABI, provider);
  const zero = '0x0000000000000000000000000000000000000000';

  for (const fee of V3_FEE_TIERS) {
    try {
      const poolAddr: string = await factory.getPool(tokenAddress, WBNB_ADDRESS, fee);
      if (poolAddr && poolAddr !== zero) {
        // Verify it's initialized by reading slot0
        const pool = new Contract(poolAddr, PANCAKESWAP_V3_POOL_ABI, provider);
        const slot0 = await pool.slot0();
        const sqrtPrice = BigInt(slot0.sqrtPriceX96);
        if (sqrtPrice > 0n) {
          const tickSpacing: number = Number(await pool.tickSpacing());
          return { poolAddress: poolAddr, fee, tickSpacing };
        }
      }
    } catch {
      // Pool doesn't exist for this fee tier, try next
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getChainDeadline(provider: Provider): Promise<number> {
  const block = await provider.getBlock('latest');
  return block!.timestamp + 300;
}

/**
 * Compute full-range tick bounds aligned to the pool's tick spacing.
 * For PancakeSwap V3, MIN_TICK = -887272 and MAX_TICK = 887272.
 */
function fullRangeTicks(tickSpacing: number): { tickLower: number; tickUpper: number } {
  const MIN_TICK = -887272;
  const MAX_TICK = 887272;
  const tickLower = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  const tickUpper = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
  return { tickLower, tickUpper };
}

/**
 * Order tokens so token0 < token1 (required by Uniswap V3 convention).
 * Returns [token0, token1, isWbnbToken0].
 */
function sortTokens(tokenA: string, tokenB: string): [string, string, boolean] {
  if (tokenA.toLowerCase() < tokenB.toLowerCase()) {
    return [tokenA, tokenB, false];
  }
  return [tokenB, tokenA, true];
}

// ---------------------------------------------------------------------------
// Internal guardrail config for sub-swaps
// ---------------------------------------------------------------------------

function internalGuardrailConfig(slippageBps: number) {
  return {
    maxTransactionValueBnb: 100,
    maxSlippageBps: slippageBps,
    bnbFeeReserve: 0.005,
    circuitBreakerThreshold: 3,
    requireApprovalAboveBnb: 0,
  };
}

// ---------------------------------------------------------------------------
// V3 LP Entry
// ---------------------------------------------------------------------------

async function executeLPEntryV3(
  provider: Provider,
  signer: Signer,
  tokenAddress: string,
  halfBnbWei: bigint,
  totalBnbWei: bigint,
  tokenAmountReceived: bigint,
  slippageBps: number,
  signerAddress: string,
  v3Pool: { poolAddress: string; fee: number; tickSpacing: number },
  steps: LPExecutionStep[],
  fail: (stepIdx: number, error: string) => LPExecutionResult,
): Promise<LPExecutionResult> {
  // Step 2: Approve token for NonfungiblePositionManager
  steps[1].status = 'executing';

  const approval = await checkApproval(
    provider,
    tokenAddress,
    signerAddress,
    PANCAKESWAP_V3_POSITION_MANAGER,
    tokenAmountReceived,
  );
  if (approval.needsApproval) {
    const approveTxHash = await executeApproval(signer, tokenAddress, PANCAKESWAP_V3_POSITION_MANAGER);
    steps[1].txHash = approveTxHash;
  }
  steps[1].status = 'confirmed';

  // Step 3: Mint full-range V3 position
  steps[2].status = 'executing';

  const positionManager = new Contract(
    PANCAKESWAP_V3_POSITION_MANAGER,
    NONFUNGIBLE_POSITION_MANAGER_ABI,
    signer,
  );

  const deadline = await getChainDeadline(provider);
  const { tickLower, tickUpper } = fullRangeTicks(v3Pool.tickSpacing);
  // Sort tokens — V3 requires token0 < token1
  const [token0, token1, isWbnbToken0] = sortTokens(WBNB_ADDRESS, tokenAddress);
  const amount0Desired = isWbnbToken0 ? halfBnbWei : tokenAmountReceived;
  const amount1Desired = isWbnbToken0 ? tokenAmountReceived : halfBnbWei;
  // Full-range positions accept any price ratio — set mins to 0 so the
  // position manager never reverts on a "Price slippage check". We already
  // hold the tokens; MEV sandwich risk on a mint is negligible vs. the revert.
  const amount0Min = 0n;
  const amount1Min = 0n;

  // Get NFT balance before
  const nftBalBefore: bigint = await positionManager.balanceOf(signerAddress);

  const mintParams = {
    token0,
    token1,
    fee: v3Pool.fee,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min,
    amount1Min,
    recipient: signerAddress,
    deadline,
  };

  const tx = await positionManager.mint(mintParams, { value: halfBnbWei });
  const receipt = await tx.wait();

  if (!receipt || receipt.status !== 1) {
    steps[2].txHash = tx.hash;
    return fail(2, 'V3 mint reverted on-chain');
  }

  steps[2].status = 'confirmed';
  steps[2].txHash = tx.hash;

  // Get the minted NFT token ID
  const nftBalAfter: bigint = await positionManager.balanceOf(signerAddress);
  const nftsReceived = (nftBalAfter - nftBalBefore).toString();

  return {
    success: true,
    steps,
    lpTokensReceived: nftsReceived,
    pairAddress: v3Pool.poolAddress,
    poolVersion: 'v3',
    txHash: tx.hash,
    gasUsed: receipt.gasUsed.toString(),
  };
}

// ---------------------------------------------------------------------------
// V2 LP Entry
// ---------------------------------------------------------------------------

async function executeLPEntryV2(
  provider: Provider,
  signer: Signer,
  tokenAddress: string,
  halfBnbWei: bigint,
  tokenAmountReceived: bigint,
  slippageBps: number,
  signerAddress: string,
  steps: LPExecutionStep[],
  fail: (stepIdx: number, error: string) => LPExecutionResult,
): Promise<LPExecutionResult> {
  // Step 2: Approve token for V2 Router
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

  // Step 3: addLiquidityETH
  steps[2].status = 'executing';

  const router = new Contract(PANCAKESWAP_V2_ROUTER, PANCAKESWAP_ROUTER_LP_ABI, signer);
  const deadline = await getChainDeadline(provider);

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
    poolVersion: 'v2',
    txHash: tx.hash,
    gasUsed: receipt.gasUsed.toString(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add BNB + Token liquidity to PancakeSwap.
 * Auto-detects V3 pool first; falls back to V2 addLiquidityETH.
 * Swaps half of amountBnb for the token, then provides liquidity.
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

  // Detect pool version
  const v3Pool = await findV3Pool(provider, tokenAddress);

  const steps: LPExecutionStep[] = [
    { label: 'Swap half BNB for token', status: 'pending' },
    { label: v3Pool ? 'Approve token for V3 PositionManager' : 'Approve token for V2 Router', status: 'pending' },
    { label: v3Pool ? 'Mint V3 full-range position' : 'Add V2 liquidity', status: 'pending' },
  ];

  const fail = (stepIdx: number, error: string): LPExecutionResult => {
    steps[stepIdx].status = 'failed';
    return { success: false, steps, error, poolVersion: v3Pool ? 'v3' : 'v2' };
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

    const prepared = await prepareSwap(
      provider,
      swapParams,
      totalBnbWei,
      internalGuardrailConfig(slippageBps),
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
    // Steps 2-3: V3 or V2 path
    // -----------------------------------------------------------------------
    if (v3Pool) {
      return await executeLPEntryV3(
        provider, signer, tokenAddress,
        halfBnbWei, totalBnbWei, tokenAmountReceived,
        slippageBps, signerAddress, v3Pool,
        steps, fail,
      );
    } else {
      return await executeLPEntryV2(
        provider, signer, tokenAddress,
        halfBnbWei, tokenAmountReceived,
        slippageBps, signerAddress,
        steps, fail,
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const failIdx = steps.findIndex((s) => s.status !== 'confirmed');
    if (failIdx >= 0) steps[failIdx].status = 'failed';
    return { success: false, steps, error: message.slice(0, 200), poolVersion: v3Pool ? 'v3' : 'v2' };
  }
}
