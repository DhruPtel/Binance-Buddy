// =============================================================================
// supply_lending — Supply tokens to Venus lending protocol via agent wallet
// Resolves token → vToken, checks balance, approves, mints.
// =============================================================================

import type { AgentTool, AgentContext } from '@binancebuddy/core';
import { resolveToken } from '@binancebuddy/core';
import {
  createProvider,
  getBnbBalance,
  executeLendingSupply,
  getOrCreateAgentWallet,
} from '@binancebuddy/blockchain';
import { fetchYieldPools } from '../data/defillama.js';

const VENUS_COMPTROLLER = '0xfD36E2c2a6789Db23113685031d7F16329158384';

async function resolveViaDefiLlama(symbol: string): Promise<string | null> {
  try {
    const pools = await fetchYieldPools();
    const upper = symbol.toUpperCase();
    const match = pools.find(
      (p) =>
        p.project.startsWith('venus') &&
        p.symbol.toUpperCase().includes(upper) &&
        p.underlyingTokens?.length,
    );
    return match?.underlyingTokens?.[0] ?? null;
  } catch {
    return null;
  }
}

export const supplyLendingTool: AgentTool = {
  name: 'supply_lending',
  description:
    'Supply tokens to Venus lending protocol on BSC. ' +
    'Resolves the vToken via Comptroller, handles approval, and executes the mint. ' +
    'Returns transaction hash and vTokens received.',
  parameters: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description: 'Token symbol (e.g. "USDT", "USDC") or contract address (0x...)',
      },
      amount: {
        type: 'string',
        description: 'Amount to supply as a decimal string (e.g. "50"). If omitted, asks user.',
      },
      tokenAddress: {
        type: 'string',
        description: 'Optional explicit token contract address. Overrides symbol lookup.',
      },
    },
    required: ['token'],
  },
  handler: async (params: Record<string, unknown>, context: AgentContext) => {
    const tokenRaw = String(params.token ?? '');
    const explicitAddr = params.tokenAddress ? String(params.tokenAddress) : null;
    const amountRaw = params.amount ? String(params.amount) : null;

    // Resolve token address
    let tokenAddress = explicitAddr ?? resolveToken(tokenRaw);
    if (!tokenAddress) {
      tokenAddress = await resolveViaDefiLlama(tokenRaw);
    }
    if (!tokenAddress) {
      return { error: `Unknown token: ${tokenRaw}. Provide a contract address or use a known symbol.` };
    }

    if (!amountRaw) {
      return {
        error: 'No amount specified. Check your token balance with check_positions first, then tell me how much to supply.',
      };
    }

    // Get fresh balances
    const provider = createProvider();
    const { wallet } = getOrCreateAgentWallet(provider);
    const signer = wallet.connect(provider);
    const signerAddress = await signer.getAddress();

    const bnbBal = await getBnbBalance(provider, signerAddress);
    const bnbFormatted = Number(bnbBal) / 1e18;
    if (bnbFormatted < 0.005) {
      return { error: `Insufficient BNB for gas. Have ${bnbFormatted.toFixed(4)} BNB, need at least 0.005.` };
    }

    try {
      const result = await executeLendingSupply(
        provider,
        signer,
        VENUS_COMPTROLLER,
        tokenAddress,
        amountRaw,
      );

      return {
        status: result.success ? 'executed' : 'execution_failed',
        txHash: result.txHash,
        token: tokenRaw.toUpperCase(),
        tokenAddress,
        amountSupplied: result.amountSupplied,
        vTokenAddress: result.vTokenAddress,
        vTokensReceived: result.vTokensReceived,
        gasUsed: result.gasUsed,
        error: result.error,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Lending supply failed: ${msg.slice(0, 200)}` };
    }
  },
};
