import { describe, it, expect } from 'vitest';
import { categorizeTx, countByCategory, getProtocolUsage } from './history.js';
import type { ParsedTransaction } from '@binancebuddy/core';
import { PANCAKESWAP_V2_ROUTER } from '@binancebuddy/core';

// Helper to build a minimal BSCScan-like tx object
function makeTx(overrides: Record<string, string> = {}) {
  return {
    hash: '0xabc',
    timeStamp: '1700000000',
    blockNumber: '100',
    from: '0xuser',
    to: '0xcontract',
    value: '0',
    gasUsed: '21000',
    gasPrice: '5000000000',
    isError: '0',
    input: '0x',
    functionName: '',
    contractAddress: '',
    ...overrides,
  };
}

describe('categorizeTx', () => {
  it('categorizes swapExactETHForTokens as swap', () => {
    const tx = makeTx({ input: '0x7ff36ab5000000000000' });
    expect(categorizeTx(tx)).toBe('swap');
  });

  it('categorizes approve', () => {
    const tx = makeTx({ input: '0x095ea7b3000000000000' });
    expect(categorizeTx(tx)).toBe('approve');
  });

  it('categorizes addLiquidityETH as farm_enter', () => {
    const tx = makeTx({ input: '0xf305d719000000000000' });
    expect(categorizeTx(tx)).toBe('farm_enter');
  });

  it('categorizes removeLiquidity as farm_exit', () => {
    const tx = makeTx({ input: '0xbaa2abde000000000000' });
    expect(categorizeTx(tx)).toBe('farm_exit');
  });

  it('categorizes plain BNB transfer', () => {
    const tx = makeTx({ input: '0x' });
    expect(categorizeTx(tx)).toBe('transfer');
  });

  it('categorizes tx to PancakeSwap router as swap', () => {
    const tx = makeTx({ to: PANCAKESWAP_V2_ROUTER, input: '0xdeadbeef00000000' });
    expect(categorizeTx(tx)).toBe('swap');
  });

  it('returns unknown for unrecognized input', () => {
    const tx = makeTx({ input: '0x12345678000000000000' });
    expect(categorizeTx(tx)).toBe('unknown');
  });
});

describe('countByCategory', () => {
  it('counts categories correctly', () => {
    const txs: ParsedTransaction[] = [
      { category: 'swap' } as ParsedTransaction,
      { category: 'swap' } as ParsedTransaction,
      { category: 'transfer' } as ParsedTransaction,
      { category: 'approve' } as ParsedTransaction,
    ];
    const counts = countByCategory(txs);
    expect(counts.swap).toBe(2);
    expect(counts.transfer).toBe(1);
    expect(counts.approve).toBe(1);
  });
});

describe('getProtocolUsage', () => {
  it('aggregates protocol usage', () => {
    const txs: ParsedTransaction[] = [
      { protocol: 'PancakeSwap', timestamp: 100 } as ParsedTransaction,
      { protocol: 'PancakeSwap', timestamp: 200 } as ParsedTransaction,
      { protocol: 'Venus', timestamp: 150 } as ParsedTransaction,
      { timestamp: 50 } as ParsedTransaction, // no protocol
    ];
    const usage = getProtocolUsage(txs);
    expect(usage).toHaveLength(2);
    expect(usage[0].protocol).toBe('PancakeSwap');
    expect(usage[0].count).toBe(2);
    expect(usage[0].lastUsed).toBe(200);
    expect(usage[1].protocol).toBe('Venus');
    expect(usage[1].count).toBe(1);
  });
});
