// =============================================================================
// withdraw_lending — Withdraw (redeem) all supplied tokens from Venus lending
// Reads vToken balance for the wallet, calls vToken.redeem(balance) to exit.
// =============================================================================

import { Contract } from 'ethers';
import type { AgentTool, AgentContext } from '@binancebuddy/core';
import { resolveToken } from '@binancebuddy/core';
import {
  createProvider,
  getBnbBalance,
  getOrCreateAgentWallet,
  resolveVToken,
  VENUS_VTOKEN_ABI,
  ERC20_ABI,
} from '@binancebuddy/blockchain';

const VENUS_COMPTROLLER = '0xfD36E2c2a6789Db23113685031d7F16329158384';

export const withdrawLendingTool: AgentTool = {
  name: 'withdraw_lending',
  description:
    'Withdraw all supplied tokens from Venus lending protocol on BSC. ' +
    'Resolves the vToken for the given token, reads the vToken balance, ' +
    'and calls redeem() to withdraw everything back to the wallet.',
  parameters: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description: 'Token symbol (e.g. "USDT", "USDC") or contract address (0x...)',
      },
    },
    required: ['token'],
  },
  handler: async (params: Record<string, unknown>, context: AgentContext) => {
    const tokenRaw = String(params.token ?? '');

    const tokenAddress = resolveToken(tokenRaw);
    if (!tokenAddress) {
      return { error: `Unknown token: ${tokenRaw}. Provide a contract address or use a known symbol.` };
    }

    const provider = createProvider();
    const { wallet } = getOrCreateAgentWallet(provider);
    const signer = wallet.connect(provider);
    const signerAddress = await signer.getAddress();

    // Check gas
    const bnbBal = await getBnbBalance(provider, signerAddress);
    const bnbFormatted = Number(bnbBal) / 1e18;
    if (bnbFormatted < 0.005) {
      return { error: `Insufficient BNB for gas. Have ${bnbFormatted.toFixed(4)} BNB, need at least 0.005.` };
    }

    // Resolve vToken
    const vTokenAddress = await resolveVToken(provider, VENUS_COMPTROLLER, tokenAddress);
    if (!vTokenAddress) {
      return { error: `No Venus vToken found for ${tokenRaw}. This token may not be listed on Venus.` };
    }

    try {
      const vToken = new Contract(vTokenAddress, VENUS_VTOKEN_ABI, signer);

      // Get vToken balance
      const vTokenBalance: bigint = await vToken.balanceOf(signerAddress);
      if (vTokenBalance === 0n) {
        return { error: `No vToken balance to withdraw. You have 0 v${tokenRaw.toUpperCase()} tokens.` };
      }

      // Get underlying token symbol for display
      const underlying = new Contract(tokenAddress, ERC20_ABI, provider);
      let tokenSymbol = tokenRaw.toUpperCase();
      try { tokenSymbol = await underlying.symbol(); } catch { /* keep raw */ }

      console.log(`[withdraw_lending] Redeeming ${vTokenBalance.toString()} vTokens from ${vTokenAddress}`);

      // Redeem all vTokens
      const tx = await vToken.redeem(vTokenBalance);
      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        return {
          status: 'execution_failed',
          txHash: tx.hash,
          error: 'Redeem transaction reverted on-chain',
        };
      }

      // Read redeemed underlying amount from balance change
      const underlyingBalance: bigint = await underlying.balanceOf(signerAddress);
      const decimals: bigint = await underlying.decimals();
      const underlyingFormatted = (Number(underlyingBalance) / 10 ** Number(decimals)).toFixed(6);

      return {
        status: 'executed',
        txHash: tx.hash,
        token: tokenSymbol,
        tokenAddress,
        vTokenAddress,
        vTokensRedeemed: vTokenBalance.toString(),
        underlyingBalance: underlyingFormatted,
        gasUsed: receipt.gasUsed.toString(),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Lending withdrawal failed: ${msg.slice(0, 200)}` };
    }
  },
};
