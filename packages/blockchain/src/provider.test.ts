import { describe, it, expect } from 'vitest';
import {
  createProvider,
  createFallbackProvider,
  checkProviderHealth,
  getBnbBalance,
} from './provider.js';

// Uses public BSC RPCs — these tests hit the network
// A well-known high-balance address (Binance Hot Wallet)
// PancakeSwap V2 Router — always has BNB from gas fees
const KNOWN_ADDRESS = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

describe('provider', () => {
  it('creates a mainnet provider and fetches block number', async () => {
    const provider = createProvider('mainnet');
    const blockNumber = await checkProviderHealth(provider);
    expect(blockNumber).toBeGreaterThan(0);
  }, 15000);

  it('fetches BNB balance for a known address', async () => {
    const provider = createProvider('mainnet');
    const balance = await getBnbBalance(provider, KNOWN_ADDRESS);
    expect(typeof balance).toBe('bigint');
  }, 15000);

  it('creates a fallback provider and fetches block number', async () => {
    const provider = createFallbackProvider('mainnet');
    const blockNumber = await checkProviderHealth(provider);
    expect(blockNumber).toBeGreaterThan(0);
  }, 15000);
});
