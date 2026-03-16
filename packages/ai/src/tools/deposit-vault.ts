// =============================================================================
// deposit_vault — Deposit into a Beefy yield vault via agent wallet
// Resolves token → vault, checks balance, approves, deposits.
// =============================================================================

import type { AgentTool, AgentContext } from '@binancebuddy/core';
import { resolveToken, bigintReplacer } from '@binancebuddy/core';
import {
  createProvider,
  getBnbBalance,
  findVaultForToken,
  executeVaultDeposit,
  getOrCreateAgentWallet,
} from '@binancebuddy/blockchain';
import { fetchYieldPools } from '../data/defillama.js';

/**
 * Try to resolve a token address from DeFiLlama pools when SAFE_TOKENS
 * doesn't know the symbol. Returns first matching underlyingTokens[0].
 */
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

export const depositVaultTool: AgentTool = {
  name: 'deposit_vault',
  description:
    'Deposit tokens into a Beefy yield vault on BSC. ' +
    'Finds the best vault for the given token, handles approval, and executes the deposit. ' +
    'Returns transaction hash and vault shares received.',
  parameters: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description: 'Token symbol (e.g. "USDT", "CAKE") or contract address (0x...)',
      },
      amount: {
        type: 'string',
        description: 'Amount to deposit as a decimal string (e.g. "100"). If omitted, uses full token balance.',
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

    // Find a Beefy vault for this token
    const vault = await findVaultForToken(tokenRaw);
    if (!vault) {
      return { error: `No active Beefy vault found for ${tokenRaw} on BSC.` };
    }

    // Get fresh balance instead of relying on stale context
    const provider = createProvider();
    const { wallet } = getOrCreateAgentWallet(provider);
    const signer = wallet.connect(provider);
    const signerAddress = await signer.getAddress();

    // Check BNB balance for gas
    const bnbBal = await getBnbBalance(provider, signerAddress);
    const bnbFormatted = Number(bnbBal) / 1e18;
    if (bnbFormatted < 0.005) {
      return { error: `Insufficient BNB for gas. Have ${bnbFormatted.toFixed(4)} BNB, need at least 0.005.` };
    }

    try {
      const depositAmount = amountRaw ?? '0';
      if (!amountRaw) {
        return {
          error: 'No amount specified. Check your token balance with check_positions first, then tell me how much to deposit.',
        };
      }

      const result = await executeVaultDeposit(provider, signer, {
        vaultAddress: vault.earnContractAddress,
        wantTokenAddress: vault.tokenAddress,
        amount: depositAmount,
      });

      return {
        status: result.success ? 'executed' : 'execution_failed',
        txHash: result.txHash,
        vault: {
          name: vault.name,
          id: vault.id,
          platform: vault.platformId,
          vaultAddress: vault.earnContractAddress,
        },
        amountDeposited: result.amountDeposited,
        sharesReceived: result.sharesReceived,
        gasUsed: result.gasUsed,
        error: result.error,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Vault deposit failed: ${msg.slice(0, 200)}` };
    }
  },
};
