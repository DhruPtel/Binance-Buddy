// =============================================================================
// Lending Executor — supply to Venus Protocol on BSC
//
// Flow:
//   1. Resolve vToken address via Comptroller.getAllMarkets() +
//      vToken.underlying() matched against the requested underlying address
//   2. Read decimals() from underlying token (never assume 18)
//   3. Check and execute approval for underlying → vToken
//   4. Call vToken.mint(amount)
//   5. Return tx hash + vTokens received
// =============================================================================

import { Contract, type Provider, type Signer } from 'ethers';
import { ERC20_ABI, VENUS_VTOKEN_ABI, VENUS_COMPTROLLER_ABI } from '../abis.js';
import { checkApproval, executeApproval } from '../dex/approval.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LendingSupplyResult {
  success: boolean;
  txHash?: string;
  vTokensReceived?: string;
  amountSupplied: string;
  vTokenAddress?: string;
  gasUsed?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// vToken resolution cache
// ---------------------------------------------------------------------------

// Maps underlying address (lowercase) → vToken address
let vTokenCache: Map<string, string> = new Map();
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Resolve which vToken corresponds to a given underlying token address.
 * Fetches all markets from the Comptroller and calls underlying() on each.
 */
export async function resolveVToken(
  provider: Provider,
  comptrollerAddress: string,
  underlyingTokenAddress: string,
): Promise<string | null> {
  const targetLower = underlyingTokenAddress.toLowerCase();

  // Check cache
  if (vTokenCache.has(targetLower) && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return vTokenCache.get(targetLower)!;
  }

  const comptroller = new Contract(comptrollerAddress, VENUS_COMPTROLLER_ABI, provider);
  const allMarkets: string[] = await comptroller.getAllMarkets();

  // Rebuild full cache
  const newCache = new Map<string, string>();
  for (const vTokenAddr of allMarkets) {
    try {
      const vToken = new Contract(vTokenAddr, VENUS_VTOKEN_ABI, provider);
      const underlying: string = await vToken.underlying();
      newCache.set(underlying.toLowerCase(), vTokenAddr);
    } catch {
      // vBNB has no underlying() — skip
    }
  }
  vTokenCache = newCache;
  cacheTimestamp = Date.now();

  return vTokenCache.get(targetLower) ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getTokenDecimals(
  provider: Provider,
  tokenAddress: string,
): Promise<number> {
  const token = new Contract(tokenAddress, ERC20_ABI, provider);
  const decimals: bigint = await token.decimals();
  return Number(decimals);
}

function parseAmount(amount: string, decimals: number): bigint {
  const parts = amount.split('.');
  const whole = parts[0] ?? '0';
  const frac = (parts[1] ?? '').padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Supply an underlying token to Venus lending.
 * Resolves the vToken via Comptroller, handles approval, and calls mint().
 */
export async function executeLendingSupply(
  provider: Provider,
  signer: Signer,
  comptrollerAddress: string,
  underlyingTokenAddress: string,
  amount: string,
): Promise<LendingSupplyResult> {
  const signerAddress = await signer.getAddress();

  // 1. Resolve vToken
  const vTokenAddress = await resolveVToken(provider, comptrollerAddress, underlyingTokenAddress);
  if (!vTokenAddress) {
    return {
      success: false,
      amountSupplied: amount,
      error: 'No Venus market found for this token',
    };
  }

  // 2. Read decimals from underlying token
  const decimals = await getTokenDecimals(provider, underlyingTokenAddress);
  const amountWei = parseAmount(amount, decimals);

  if (amountWei <= 0n) {
    return { success: false, amountSupplied: amount, error: 'Amount must be positive' };
  }

  // 3. Check balance
  const underlying = new Contract(underlyingTokenAddress, ERC20_ABI, provider);
  const balance: bigint = await underlying.balanceOf(signerAddress);
  if (balance < amountWei) {
    const balFormatted = Number(balance) / 10 ** decimals;
    return {
      success: false,
      amountSupplied: amount,
      error: `Insufficient balance: have ${balFormatted.toFixed(4)}, need ${amount}`,
    };
  }

  try {
    // 4. Approve if needed
    const approval = await checkApproval(
      provider,
      underlyingTokenAddress,
      signerAddress,
      vTokenAddress,
      amountWei,
    );
    if (approval.needsApproval) {
      await executeApproval(signer, underlyingTokenAddress, vTokenAddress);
    }

    // 5. Get vToken balance before mint
    const vToken = new Contract(vTokenAddress, VENUS_VTOKEN_ABI, signer);
    const vBalBefore: bigint = await vToken.balanceOf(signerAddress);

    // 6. Execute mint
    const tx = await vToken.mint(amountWei);
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      return {
        success: false,
        txHash: tx.hash,
        amountSupplied: amount,
        vTokenAddress,
        error: 'Supply transaction reverted on-chain',
      };
    }

    // 7. Calculate vTokens received
    const vBalAfter: bigint = await vToken.balanceOf(signerAddress);
    const vTokensReceived = vBalAfter - vBalBefore;

    return {
      success: true,
      txHash: tx.hash,
      vTokensReceived: vTokensReceived.toString(),
      amountSupplied: amount,
      vTokenAddress,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      amountSupplied: amount,
      vTokenAddress,
      error: message.slice(0, 200),
    };
  }
}

/**
 * Get account liquidity from Venus Comptroller.
 * Returns (error, liquidity, shortfall) — all in USD with 18 decimals.
 */
export async function getAccountLiquidity(
  provider: Provider,
  comptrollerAddress: string,
  account: string,
): Promise<{ error: bigint; liquidity: bigint; shortfall: bigint }> {
  const comptroller = new Contract(comptrollerAddress, VENUS_COMPTROLLER_ABI, provider);
  const [error, liquidity, shortfall]: [bigint, bigint, bigint] =
    await comptroller.getAccountLiquidity(account);
  return { error, liquidity, shortfall };
}
