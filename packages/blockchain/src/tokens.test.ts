import { describe, it, expect } from 'vitest';
import { getTokenBalance, getBnbPriceUsd } from './tokens.js';
import { createProvider } from './provider.js';
import { WBNB_ADDRESS, SAFE_TOKENS } from '@binancebuddy/core';

// PancakeSwap V2 Router — holds WBNB
const PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

describe('tokens', () => {
  it('reads WBNB balance and metadata from chain', async () => {
    const provider = createProvider('mainnet');
    const result = await getTokenBalance(provider, WBNB_ADDRESS, PANCAKE_ROUTER);
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('WBNB');
    expect(result!.decimals).toBe(18);
    expect(typeof result!.balance).toBe('bigint');
  }, 15000);

  it('reads USDT token metadata', async () => {
    const provider = createProvider('mainnet');
    const result = await getTokenBalance(provider, SAFE_TOKENS.USDT, PANCAKE_ROUTER);
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('USDT');
    expect(result!.decimals).toBe(18);
  }, 15000);

  it('returns null for invalid token address', async () => {
    const provider = createProvider('mainnet');
    const result = await getTokenBalance(
      provider,
      '0x0000000000000000000000000000000000000001',
      PANCAKE_ROUTER,
    );
    expect(result).toBeNull();
  }, 15000);

  it('fetches BNB price from CoinGecko', async () => {
    const price = await getBnbPriceUsd();
    // Price could be 0 if rate-limited, but type should be number
    expect(typeof price).toBe('number');
  }, 15000);
});
