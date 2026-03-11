// =============================================================================
// @binancebuddy/blockchain — Transaction History
// Primary: Moralis REST API. Fallback: Ankr JSON-RPC (paid).
// Returns [] gracefully when no key is set.
// =============================================================================

import type { ParsedTransaction, TxCategory } from '@binancebuddy/core';
import {
  ANKR_MULTICHAIN_URL,
  ADDRESS_TO_PROTOCOL,
  KNOWN_PROTOCOLS,
} from '@binancebuddy/core';
import { rateLimiter } from './rate-limiter.js';

const MORALIS_BASE_URL = 'https://deep-index.moralis.io/api/v2.2';
const TX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Moralis raw transaction type
// ---------------------------------------------------------------------------

interface MoralisTx {
  hash: string;
  block_timestamp: string; // ISO 8601 e.g. "2023-01-01T00:00:00.000Z"
  block_number: string;
  from_address: string;
  to_address: string;
  value: string;
  gas: string;
  gas_price: string;
  receipt_gas_used: string;
  receipt_status: string; // "1" = success, "0" = failed
  input: string;
}

interface MoralisResponse {
  result: MoralisTx[];
  cursor?: string | null;
}

// ---------------------------------------------------------------------------
// Ankr raw transaction type (fallback)
// ---------------------------------------------------------------------------

interface AnkrTx {
  hash: string;
  timestamp: number;
  blockNumber: number;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  status: number; // 1 = success, 0 = failed
  input: string;
}

interface AnkrTxResponse {
  result?: { transactions: AnkrTx[]; nextPageToken?: string };
  error?: { code: number; message: string };
}

// ---------------------------------------------------------------------------
// Known function selectors (first 4 bytes of keccak256)
// ---------------------------------------------------------------------------

const SELECTORS: Record<string, TxCategory> = {
  '0x38ed1739': 'swap',       // swapExactTokensForTokens
  '0x8803dbee': 'swap',       // swapTokensForExactTokens
  '0x7ff36ab5': 'swap',       // swapExactETHForTokens
  '0x18cbafe5': 'swap',       // swapExactTokensForETH
  '0xfb3bdb41': 'swap',       // swapETHForExactTokens
  '0x5c11d795': 'swap',       // swapExactTokensForTokensSupportingFeeOnTransferTokens
  '0xb6f9de95': 'swap',       // swapExactETHForTokensSupportingFeeOnTransferTokens
  '0x791ac947': 'swap',       // swapExactTokensForETHSupportingFeeOnTransferTokens
  '0x04e45aaf': 'swap',       // exactInputSingle (V3)
  '0xb858183f': 'swap',       // exactInput (V3)
  '0x095ea7b3': 'approve',    // approve
  '0xe8e33700': 'farm_enter', // addLiquidity
  '0xf305d719': 'farm_enter', // addLiquidityETH
  '0xbaa2abde': 'farm_exit',  // removeLiquidity
  '0x02751cec': 'farm_exit',  // removeLiquidityETH
  '0xa694fc3a': 'stake',      // stake
  '0x2e1a7d4d': 'unstake',    // withdraw
  '0xe449022e': 'swap',       // uniswapV3Swap (1inch)
};

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

export function categorizeTx(tx: { input: string; to: string }): TxCategory {
  const input = tx.input ?? '';
  const selector = input.slice(0, 10).toLowerCase();

  if (selector && SELECTORS[selector]) return SELECTORS[selector];

  const toAddr = tx.to?.toLowerCase() ?? '';
  const protocol = ADDRESS_TO_PROTOCOL[toAddr];
  if (protocol) {
    for (const [, proto] of Object.entries(KNOWN_PROTOCOLS)) {
      if (proto.name === protocol) {
        if (proto.category === 'dex') return 'swap';
        if (proto.category === 'farming') return 'farm_enter';
        if (proto.category === 'lending') return 'stake';
      }
    }
  }

  if (input === '0x' || input === '') return 'transfer';
  if (selector === '0x095ea7b3') return 'approve';
  return 'unknown';
}

export function identifyProtocol(tx: { to: string }): string | undefined {
  return ADDRESS_TO_PROTOCOL[tx.to?.toLowerCase() ?? ''];
}

// ---------------------------------------------------------------------------
// Moralis fetch
// ---------------------------------------------------------------------------

async function fetchViaMoralis(
  walletAddress: string,
  moralisApiKey: string,
): Promise<ParsedTransaction[]> {
  const url = new URL(`${MORALIS_BASE_URL}/${walletAddress}`);
  url.searchParams.set('chain', 'bsc');
  url.searchParams.set('limit', String(TX_LIMIT));
  url.searchParams.set('order', 'DESC');

  const cacheKey = `history:moralis:${walletAddress.toLowerCase()}`;

  const raw = await rateLimiter.track(cacheKey, async () => {
    const res = await fetch(url.toString(), {
      headers: { 'X-API-Key': moralisApiKey },
    });
    if (!res.ok) throw new Error(`Moralis ${res.status}: ${res.statusText}`);
    return (await res.json()) as MoralisResponse;
  });

  return (raw.result ?? []).map(parseMoralisTx);
}

function parseMoralisTx(tx: MoralisTx): ParsedTransaction {
  const to = tx.to_address ?? '';
  const input = tx.input ?? '0x';
  return {
    hash: tx.hash,
    timestamp: Math.floor(new Date(tx.block_timestamp).getTime() / 1000),
    blockNumber: parseInt(tx.block_number, 10),
    from: tx.from_address,
    to,
    value: tx.value,
    gasUsed: tx.receipt_gas_used,
    gasPrice: tx.gas_price,
    status: tx.receipt_status === '1' ? 'success' : 'failed',
    category: categorizeTx({ input, to }),
    protocol: identifyProtocol({ to }),
  };
}

// ---------------------------------------------------------------------------
// Ankr fallback fetch
// ---------------------------------------------------------------------------

async function fetchViaAnkr(
  walletAddress: string,
  ankrApiKey: string,
): Promise<ParsedTransaction[]> {
  const endpoint = `${ANKR_MULTICHAIN_URL}/${ankrApiKey}`;
  const cacheKey = `history:ankr:${walletAddress.toLowerCase()}`;

  const raw = await rateLimiter.track(cacheKey, async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'ankr_getTransactionsByAddress',
        params: { walletAddress, blockchain: ['bsc'], pageSize: TX_LIMIT },
        id: 1,
      }),
    });
    return (await res.json()) as AnkrTxResponse;
  });

  return (raw.result?.transactions ?? []).map(parseAnkrTx);
}

function parseAnkrTx(tx: AnkrTx): ParsedTransaction {
  return {
    hash: tx.hash,
    timestamp: tx.timestamp,
    blockNumber: tx.blockNumber,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    gasUsed: tx.gasUsed,
    gasPrice: tx.gasPrice,
    status: tx.status === 1 ? 'success' : 'failed',
    category: categorizeTx(tx),
    protocol: identifyProtocol(tx),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch transaction history for a BSC wallet.
 * Uses Moralis if a key is provided, falls back to Ankr, returns [] if neither.
 * Results are cached 60 seconds by the rate limiter.
 */
export async function fetchTransactionHistory(
  walletAddress: string,
  moralisApiKey?: string,
  ankrApiKey?: string,
): Promise<ParsedTransaction[]> {
  try {
    if (moralisApiKey) return await fetchViaMoralis(walletAddress, moralisApiKey);
    if (ankrApiKey) return await fetchViaAnkr(walletAddress, ankrApiKey);
    return [];
  } catch (e) {
    console.error('[history] fetchTransactionHistory failed:', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

export function countByCategory(
  txs: ParsedTransaction[],
): Record<TxCategory, number> {
  const counts = {} as Record<TxCategory, number>;
  for (const tx of txs) {
    counts[tx.category] = (counts[tx.category] ?? 0) + 1;
  }
  return counts;
}

export function getProtocolUsage(
  txs: ParsedTransaction[],
): { protocol: string; count: number; lastUsed: number }[] {
  const map = new Map<string, { count: number; lastUsed: number }>();
  for (const tx of txs) {
    if (tx.protocol) {
      const existing = map.get(tx.protocol);
      if (existing) {
        existing.count++;
        existing.lastUsed = Math.max(existing.lastUsed, tx.timestamp);
      } else {
        map.set(tx.protocol, { count: 1, lastUsed: tx.timestamp });
      }
    }
  }
  return Array.from(map.entries())
    .map(([protocol, data]) => ({ protocol, ...data }))
    .sort((a, b) => b.count - a.count);
}
