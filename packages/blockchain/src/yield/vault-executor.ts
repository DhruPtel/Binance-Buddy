// =============================================================================
// Vault Executor — deposit into Beefy-style vaults
//
// Flow:
//   1. Read want token decimals (never assume 18)
//   2. Check approval for want token → vault
//   3. If needed: approve
//   4. Call vault.deposit(amount)
//   5. Return tx hash + shares received
// =============================================================================

import { Contract, type Provider, type Signer } from 'ethers';
import { ERC20_ABI, BEEFY_VAULT_ABI } from '../abis.js';
import { checkApproval, executeApproval } from '../dex/approval.js';
import { BNB_FEE_RESERVE } from '@binancebuddy/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultDepositResult {
  success: boolean;
  txHash?: string;
  sharesReceived?: string;
  amountDeposited: string;
  gasUsed?: string;
  error?: string;
}

export interface VaultDepositParams {
  vaultAddress: string;
  wantTokenAddress: string;
  amount: string; // human-readable decimal (e.g. "100.5")
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

async function getTokenBalance(
  provider: Provider,
  tokenAddress: string,
  owner: string,
): Promise<bigint> {
  const token = new Contract(tokenAddress, ERC20_ABI, provider);
  return token.balanceOf(owner) as Promise<bigint>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pre-flight check: validates the vault, checks balances and approval status.
 * Does NOT execute anything on-chain (except read calls).
 */
export async function prepareVaultDeposit(
  provider: Provider,
  signerAddress: string,
  params: VaultDepositParams,
): Promise<{
  decimals: number;
  amountWei: bigint;
  balance: bigint;
  needsApproval: boolean;
  error?: string;
}> {
  const { vaultAddress, wantTokenAddress, amount } = params;

  // Read decimals from the want token contract
  const decimals = await getTokenDecimals(provider, wantTokenAddress);

  // Parse amount to wei using actual decimals
  const parts = amount.split('.');
  const whole = parts[0] ?? '0';
  const frac = (parts[1] ?? '').padEnd(decimals, '0').slice(0, decimals);
  const amountWei = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac);

  if (amountWei <= 0n) {
    return { decimals, amountWei, balance: 0n, needsApproval: false, error: 'Amount must be positive' };
  }

  // Check balance
  const balance = await getTokenBalance(provider, wantTokenAddress, signerAddress);
  if (balance < amountWei) {
    const balFormatted = Number(balance) / 10 ** decimals;
    return {
      decimals,
      amountWei,
      balance,
      needsApproval: false,
      error: `Insufficient balance: have ${balFormatted.toFixed(4)}, need ${amount}`,
    };
  }

  // Check approval
  const approval = await checkApproval(
    provider,
    wantTokenAddress,
    signerAddress,
    vaultAddress,
    amountWei,
  );

  return { decimals, amountWei, balance, needsApproval: approval.needsApproval };
}

/**
 * Execute a vault deposit. Handles approval + deposit in sequence.
 * Takes explicit addresses — no knowledge of where they came from.
 */
export async function executeVaultDeposit(
  provider: Provider,
  signer: Signer,
  params: VaultDepositParams,
): Promise<VaultDepositResult> {
  const signerAddress = await signer.getAddress();
  const { vaultAddress, wantTokenAddress, amount } = params;

  // Pre-flight
  const prep = await prepareVaultDeposit(provider, signerAddress, params);
  if (prep.error) {
    return { success: false, amountDeposited: amount, error: prep.error };
  }

  try {
    // Approve if needed
    if (prep.needsApproval) {
      await executeApproval(signer, wantTokenAddress, vaultAddress);
    }

    // Get shares balance before deposit
    const vault = new Contract(vaultAddress, BEEFY_VAULT_ABI, signer);
    const sharesBefore: bigint = await vault.balanceOf(signerAddress);

    // Execute deposit
    const tx = await vault.deposit(prep.amountWei);
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      return {
        success: false,
        txHash: tx.hash,
        amountDeposited: amount,
        error: 'Deposit transaction reverted on-chain',
      };
    }

    // Calculate shares received
    const sharesAfter: bigint = await vault.balanceOf(signerAddress);
    const sharesReceived = sharesAfter - sharesBefore;

    return {
      success: true,
      txHash: tx.hash,
      sharesReceived: sharesReceived.toString(),
      amountDeposited: amount,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      amountDeposited: amount,
      error: message.slice(0, 200),
    };
  }
}
