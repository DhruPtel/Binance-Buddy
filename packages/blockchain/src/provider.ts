// =============================================================================
// @binancebuddy/blockchain — BSC Provider
// Manages ethers.js JsonRpcProvider with fallback RPC support.
// =============================================================================

import { JsonRpcProvider, FallbackProvider } from 'ethers';
import {
  BSC_CHAIN_ID,
  BSC_TESTNET_CHAIN_ID,
  BSC_RPC_URLS,
} from '@binancebuddy/core';

export type Network = 'mainnet' | 'testnet';

/**
 * Create a single JsonRpcProvider for BSC.
 * Uses the first URL from the list or a custom RPC URL.
 */
export function createProvider(
  network: Network = 'mainnet',
  rpcUrl?: string,
): JsonRpcProvider {
  const chainId = network === 'mainnet' ? BSC_CHAIN_ID : BSC_TESTNET_CHAIN_ID;
  const url = rpcUrl ?? BSC_RPC_URLS[network][0];

  return new JsonRpcProvider(url, chainId, {
    staticNetwork: true,
    batchMaxCount: 1, // BSC public RPCs don't reliably support batching
  });
}

/**
 * Create a FallbackProvider that tries multiple BSC RPC endpoints.
 * Each provider is given equal priority (1) and a 5-second stall timeout.
 */
export function createFallbackProvider(
  network: Network = 'mainnet',
  customUrls?: string[],
): FallbackProvider {
  const chainId = network === 'mainnet' ? BSC_CHAIN_ID : BSC_TESTNET_CHAIN_ID;
  const urls = customUrls ?? [...BSC_RPC_URLS[network]];

  const providers = urls.map((url, i) => ({
    provider: new JsonRpcProvider(url, chainId, { staticNetwork: true }),
    priority: 1,
    stallTimeout: 5000,
    weight: 1 + (i === 0 ? 1 : 0), // slightly prefer first URL
  }));

  return new FallbackProvider(providers, chainId);
}

/**
 * Quick health check — fetches the latest block number.
 * Returns the block number on success, throws on failure.
 */
export async function checkProviderHealth(
  provider: JsonRpcProvider | FallbackProvider,
): Promise<number> {
  const blockNumber = await provider.getBlockNumber();
  return blockNumber;
}

/**
 * Get BNB balance for an address (returns bigint).
 */
export async function getBnbBalance(
  provider: JsonRpcProvider | FallbackProvider,
  address: string,
): Promise<bigint> {
  return provider.getBalance(address);
}
