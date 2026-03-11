// =============================================================================
// Token Approval — check and execute ERC-20 approve() before swaps
// =============================================================================

import { Contract, type Provider, type Signer, MaxUint256 } from 'ethers';
import type { TokenApproval } from '@binancebuddy/core';

// ---------------------------------------------------------------------------
// ABI (minimal)
// ---------------------------------------------------------------------------

const ERC20_ABI = [
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
];

// ---------------------------------------------------------------------------
// Check allowance
// ---------------------------------------------------------------------------

/**
 * Returns approval status for a token/spender pair.
 * needsApproval is true when currentAllowance < requiredAmount.
 */
export async function checkApproval(
  provider: Provider,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  requiredAmount: bigint,
): Promise<TokenApproval> {
  const erc20 = new Contract(tokenAddress, ERC20_ABI, provider);
  const currentAllowance: bigint = await erc20.allowance(ownerAddress, spenderAddress);

  return {
    tokenAddress,
    spenderAddress,
    currentAllowance: currentAllowance.toString(),
    requiredAmount: requiredAmount.toString(),
    needsApproval: currentAllowance < requiredAmount,
  };
}

// ---------------------------------------------------------------------------
// Execute approve()
// ---------------------------------------------------------------------------

/**
 * Approves the spender to spend `amount` of `tokenAddress`.
 * Pass MaxUint256 to grant unlimited approval (common for DEXes).
 * Returns the tx hash on success.
 */
export async function executeApproval(
  signer: Signer,
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint = MaxUint256,
): Promise<string> {
  const erc20 = new Contract(tokenAddress, ERC20_ABI, signer);
  const tx = await erc20.approve(spenderAddress, amount);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error('Approval transaction failed');
  }
  return tx.hash as string;
}
