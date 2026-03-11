// =============================================================================
// @binancebuddy/blockchain — Transaction History
// Fetches and categorizes BSC transactions via BSCScan API.
// =============================================================================

import type { ParsedTransaction, TxCategory } from '@binancebuddy/core';
import {
  BSCSCAN_API_URL,
  BSCSCAN_TX_LIMIT,
  ADDRESS_TO_PROTOCOL,
  KNOWN_PROTOCOLS,
} from '@binancebuddy/core';

// ---------------------------------------------------------------------------
// BSCScan raw transaction type
// ---------------------------------------------------------------------------

interface BscScanTx {
  hash: string;
  timeStamp: string;
  blockNumber: string;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  gasPrice: string;
  isError: string;
  input: string;
  functionName: string;
  contractAddress: string;
}

// ---------------------------------------------------------------------------
// Known function selectors (first 4 bytes of keccak256)
// ---------------------------------------------------------------------------

const SELECTORS: Record<string, TxCategory> = {
  '0x38ed1739': 'swap',     // swapExactTokensForTokens
  '0x8803dbee': 'swap',     // swapTokensForExactTokens
  '0x7ff36ab5': 'swap',     // swapExactETHForTokens
  '0x18cbafe5': 'swap',     // swapExactTokensForETH
  '0xfb3bdb41': 'swap',     // swapETHForExactTokens
  '0x5c11d795': 'swap',     // swapExactTokensForTokensSupportingFeeOnTransferTokens
  '0xb6f9de95': 'swap',     // swapExactETHForTokensSupportingFeeOnTransferTokens
  '0x791ac947': 'swap',     // swapExactTokensForETHSupportingFeeOnTransferTokens
  '0x04e45aaf': 'swap',     // exactInputSingle (V3)
  '0xb858183f': 'swap',     // exactInput (V3)
  '0x095ea7b3': 'approve',  // approve
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
 * Categorize a single transaction based on its function selector,
 * target address, and known protocol mappings.
 */
export function categorizeTx(tx: BscScanTx): TxCategory {
  const input = tx.input ?? '';
  const selector = input.slice(0, 10).toLowerCase();

  // Check function selector first
  if (selector && SELECTORS[selector]) {
    return SELECTORS[selector];
  }

  // Check by known protocol category
  const toAddr = tx.to.toLowerCase();
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

  // Plain BNB transfer (no input data)
  if (input === '0x' || input === '') {
    return 'transfer';
  }

  // Approve is very common
  if (selector === '0x095ea7b3') {
    return 'approve';
  }

  return 'unknown';
}

/**
 * Identify the protocol name for a transaction based on the target address.
 */
export function identifyProtocol(tx: BscScanTx): string | undefined {
  return ADDRESS_TO_PROTOCOL[tx.to.toLowerCase()];
}

// ---------------------------------------------------------------------------
// Fetch & Parse
// ---------------------------------------------------------------------------

/**
 * Fetch transaction history from BSCScan and return parsed, categorized transactions.
 */
export async function fetchTransactionHistory(
  walletAddress: string,
  apiKey: string,
  limit: number = BSCSCAN_TX_LIMIT,
): Promise<ParsedTransaction[]> {
  const url = new URL(BSCSCAN_API_URL);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', walletAddress);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock', '99999999');
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', String(limit));
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('apikey', apiKey);

  const res = await fetch(url.toString());
  const json = (await res.json()) as {
    status: string;
    result: BscScanTx[] | string;
  };

  if (json.status !== '1' || !Array.isArray(json.result)) {
    return [];
  }

  return json.result.map(parseTx);
}

/**
 * Parse a raw BSCScan transaction into our ParsedTransaction type.
 */
function parseTx(tx: BscScanTx): ParsedTransaction {
  return {
    hash: tx.hash,
    timestamp: parseInt(tx.timeStamp, 10),
    blockNumber: parseInt(tx.blockNumber, 10),
    from: tx.from,
    to: tx.to,
    value: tx.value,
    gasUsed: tx.gasUsed,
    gasPrice: tx.gasPrice,
    status: tx.isError === '0' ? 'success' : 'failed',
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
