// =============================================================================
// @binancebuddy/blockchain — Transaction History
// Fetches and categorizes BSC transactions via Ankr Enhanced API.
// =============================================================================

import type { ParsedTransaction, TxCategory } from '@binancebuddy/core';
import {
  ANKR_MULTICHAIN_URL,
  ANKR_TX_LIMIT,
  ADDRESS_TO_PROTOCOL,
  KNOWN_PROTOCOLS,
} from '@binancebuddy/core';

// ---------------------------------------------------------------------------
// Ankr raw transaction type
// ---------------------------------------------------------------------------

interface AnkrTx {
  hash: string;
  timestamp: number;        // unix seconds (number, not string)
  blockNumber: number;      // number, not string
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  status: number;           // 1 = success, 0 = failed
  input: string;
}

interface AnkrTxResponse {
  jsonrpc: string;
  id: number;
  result?: {
    transactions: AnkrTx[];
    nextPageToken?: string;
  };
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
// Categorization logic
// ---------------------------------------------------------------------------

/**
 * Categorize a single transaction based on its function selector
 * and known protocol mappings. Accepts any object with input and to fields.
 */
export function categorizeTx(tx: { input: string; to: string }): TxCategory {
  const input = tx.input ?? '';
  const selector = input.slice(0, 10).toLowerCase();

  if (selector && SELECTORS[selector]) {
    return SELECTORS[selector];
  }

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

  if (input === '0x' || input === '') {
    return 'transfer';
  }

  if (selector === '0x095ea7b3') {
    return 'approve';
  }

  return 'unknown';
}

/**
 * Identify the protocol name for a transaction based on the target address.
 */
export function identifyProtocol(tx: { to: string }): string | undefined {
  return ADDRESS_TO_PROTOCOL[tx.to?.toLowerCase() ?? ''];
}

// ---------------------------------------------------------------------------
// Fetch & Parse
// ---------------------------------------------------------------------------

/**
 * Fetch transaction history from Ankr and return parsed, categorized transactions.
 */
export async function fetchTransactionHistory(
  walletAddress: string,
  ankrApiKey?: string,
  limit: number = ANKR_TX_LIMIT,
): Promise<ParsedTransaction[]> {
  // Tx history requires a paid Ankr key. Without one, return empty gracefully.
  if (!ankrApiKey) return [];

  const endpoint = ankrApiKey
    ? `${ANKR_MULTICHAIN_URL}/${ankrApiKey}`
    : ANKR_MULTICHAIN_URL;

  const body = {
    jsonrpc: '2.0',
    method: 'ankr_getTransactionsByAddress',
    params: {
      walletAddress,
      blockchain: ['bsc'],
      pageSize: limit,
    },
    id: 1,
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as AnkrTxResponse;

    if (!json.result?.transactions) {
      return [];
    }

    return json.result.transactions.map(parseTx);
  } catch {
    return [];
  }
}

/**
 * Parse a raw Ankr transaction into our ParsedTransaction type.
 */
function parseTx(tx: AnkrTx): ParsedTransaction {
  return {
    hash: tx.hash,
    timestamp: tx.timestamp,          // already a number
    blockNumber: tx.blockNumber,      // already a number
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
// Analysis helpers
// ---------------------------------------------------------------------------

/**
 * Count transactions by category.
 */
export function countByCategory(
  txs: ParsedTransaction[],
): Record<TxCategory, number> {
  const counts = {} as Record<TxCategory, number>;
  for (const tx of txs) {
    counts[tx.category] = (counts[tx.category] ?? 0) + 1;
  }
  return counts;
}

/**
 * Get unique protocols used, with interaction counts.
 */
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
