// =============================================================================
// withdraw_liquidity — Withdraw a PancakeSwap V3 LP position via NFT
//
// Flow:
//   1. balanceOf(wallet) → number of NFT positions
//   2. tokenOfOwnerByIndex → token IDs
//   3. positions(tokenId) → liquidity + pair info
//   4. decreaseLiquidity(tokenId, liquidity, 0, 0, deadline) → burn liquidity
//   5. collect(tokenId, wallet, MAX_UINT128, MAX_UINT128) → receive tokens
//
// If tokenId is not specified, withdraws ALL positions found.
// =============================================================================

import { Contract } from 'ethers';
import type { AgentTool, AgentContext } from '@binancebuddy/core';
import { PANCAKESWAP_V3_POSITION_MANAGER } from '@binancebuddy/core';
import {
  createProvider,
  getBnbBalance,
  getOrCreateAgentWallet,
  NONFUNGIBLE_POSITION_MANAGER_ABI,
  ERC20_ABI,
} from '@binancebuddy/blockchain';

const MAX_UINT128 = (2n ** 128n) - 1n;

interface PositionInfo {
  tokenId: string;
  token0: string;
  token1: string;
  fee: number;
  liquidity: string;
  symbol0: string;
  symbol1: string;
}

async function getSymbol(provider: InstanceType<typeof import('ethers').JsonRpcProvider>, address: string): Promise<string> {
  try {
    const token = new Contract(address, ERC20_ABI, provider);
    return await token.symbol();
  } catch {
    return address.slice(0, 8) + '...';
  }
}

export const withdrawLiquidityTool: AgentTool = {
  name: 'withdraw_liquidity',
  description:
    'Withdraw PancakeSwap V3 LP positions from the agent wallet. ' +
    'Scans all NFT positions, decreases liquidity to zero, and collects both tokens back. ' +
    'Optionally specify a tokenId to withdraw a single position; omit to withdraw all.',
  parameters: {
    type: 'object',
    properties: {
      tokenId: {
        type: 'string',
        description: 'Optional NFT position token ID to withdraw. If omitted, withdraws all positions.',
      },
    },
    required: [],
  },
  handler: async (params: Record<string, unknown>, _context: AgentContext) => {
    const specificTokenId = params.tokenId ? String(params.tokenId) : null;

    const provider = createProvider();
    const { wallet } = getOrCreateAgentWallet(provider);
    const signer = wallet.connect(provider);
    const signerAddress = await signer.getAddress();

    // Gas check
    const bnbBal = await getBnbBalance(provider, signerAddress);
    const bnbFormatted = Number(bnbBal) / 1e18;
    if (bnbFormatted < 0.005) {
      return { error: `Insufficient BNB for gas. Have ${bnbFormatted.toFixed(4)} BNB, need at least 0.005.` };
    }

    const positionManager = new Contract(
      PANCAKESWAP_V3_POSITION_MANAGER,
      NONFUNGIBLE_POSITION_MANAGER_ABI,
      signer,
    );

    try {
      // -----------------------------------------------------------------------
      // 1. Discover positions
      // -----------------------------------------------------------------------
      let tokenIds: string[];

      if (specificTokenId) {
        tokenIds = [specificTokenId];
      } else {
        const count: bigint = await positionManager.balanceOf(signerAddress);
        if (count === 0n) {
          return { error: 'No V3 LP positions found in the agent wallet.' };
        }
        const indices = Array.from({ length: Number(count) }, (_, i) => i);
        const ids = await Promise.all(
          indices.map((i) => positionManager.tokenOfOwnerByIndex(signerAddress, i)),
        );
        tokenIds = ids.map((id: bigint) => id.toString());
      }

      // -----------------------------------------------------------------------
      // 2. Read position details and filter out empty ones
      // -----------------------------------------------------------------------
      const positions: PositionInfo[] = [];
      for (const tokenId of tokenIds) {
        const pos = await positionManager.positions(BigInt(tokenId));
        const liquidity: bigint = BigInt(pos.liquidity);
        if (liquidity === 0n) continue; // already withdrawn

        const [symbol0, symbol1] = await Promise.all([
          getSymbol(provider as Parameters<typeof getSymbol>[0], pos.token0),
          getSymbol(provider as Parameters<typeof getSymbol>[0], pos.token1),
        ]);

        positions.push({
          tokenId,
          token0: pos.token0,
          token1: pos.token1,
          fee: Number(pos.fee),
          liquidity: liquidity.toString(),
          symbol0,
          symbol1,
        });
      }

      if (positions.length === 0) {
        return { error: 'All found positions have zero liquidity (already withdrawn).' };
      }

      // -----------------------------------------------------------------------
      // 3. Withdraw each position
      // -----------------------------------------------------------------------
      const block = await provider.getBlock('latest');
      const deadline = block!.timestamp + 300;

      const results = [];
      for (const pos of positions) {
        console.log(`[withdraw_liquidity] Withdrawing tokenId=${pos.tokenId} (${pos.symbol0}/${pos.symbol1})`);

        // decreaseLiquidity → burn all liquidity
        const decreaseTx = await positionManager.decreaseLiquidity({
          tokenId: BigInt(pos.tokenId),
          liquidity: BigInt(pos.liquidity),
          amount0Min: 0n,
          amount1Min: 0n,
          deadline,
        });
        const decreaseReceipt = await decreaseTx.wait();

        if (!decreaseReceipt || decreaseReceipt.status !== 1) {
          results.push({
            tokenId: pos.tokenId,
            pair: `${pos.symbol0}/${pos.symbol1}`,
            status: 'failed',
            error: 'decreaseLiquidity reverted',
          });
          continue;
        }

        // collect → transfer tokens back to wallet
        const collectTx = await positionManager.collect({
          tokenId: BigInt(pos.tokenId),
          recipient: signerAddress,
          amount0Max: MAX_UINT128,
          amount1Max: MAX_UINT128,
        });
        const collectReceipt = await collectTx.wait();

        if (!collectReceipt || collectReceipt.status !== 1) {
          results.push({
            tokenId: pos.tokenId,
            pair: `${pos.symbol0}/${pos.symbol1}`,
            status: 'failed',
            error: 'collect reverted after decreaseLiquidity succeeded',
            decreaseTxHash: decreaseTx.hash,
          });
          continue;
        }

        results.push({
          tokenId: pos.tokenId,
          pair: `${pos.symbol0}/${pos.symbol1}`,
          fee: pos.fee,
          liquidityRemoved: pos.liquidity,
          status: 'executed',
          decreaseTxHash: decreaseTx.hash,
          collectTxHash: collectTx.hash,
          gasUsed: (BigInt(decreaseReceipt.gasUsed) + BigInt(collectReceipt.gasUsed)).toString(),
        });
      }

      const succeeded = results.filter((r) => r.status === 'executed').length;
      return {
        status: succeeded === results.length ? 'executed' : 'partial',
        positionsWithdrawn: succeeded,
        positionsTotal: results.length,
        results,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Liquidity withdrawal failed: ${msg.slice(0, 200)}` };
    }
  },
};
