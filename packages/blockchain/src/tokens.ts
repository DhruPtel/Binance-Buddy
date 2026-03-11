// =============================================================================
// @binancebuddy/blockchain — Token Scanner
// Fetches BEP-20 balances via BSCScan API, prices via CoinGecko.
// =============================================================================

import { Contract, formatUnits } from 'ethers';
import type { JsonRpcProvider, FallbackProvider } from 'ethers';
import type { TokenInfo } from '@binancebuddy/core';
import {
  BSCSCAN_API_URL,
  COINGECKO_API_URL,
  WBNB_ADDRESS,
  TOKEN_SYMBOL_MAP,
} from '@binancebuddy/core';

// Minimal ERC-20 ABI for on-chain balance reads
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

// ---------------------------------------------------------------------------
// BSCScan: discover which tokens a wallet holds
// ---------------------------------------------------------------------------

interface BscScanTokenTx {
  contractAddress: string;
  tokenSymbol: string;
  tokenName: string;
  tokenDecimal: string;
}

/**
 * Fetch the list of unique token contract addresses a wallet has interacted with.
 * Uses BSCScan's tokentx endpoint to discover held tokens.
 */
export async function discoverTokens(
  walletAddress: string,
  apiKey: string,
): Promise<BscScanTokenTx[]> {
  const url = new URL(BSCSCAN_API_URL);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'tokentx');
  url.searchParams.set('address', walletAddress);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock', '99999999');
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '1000');
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('apikey', apiKey);

  const res = await fetch(url.toString());
  const json = (await res.json()) as {
    status: string;
    result: BscScanTokenTx[] | string;
  };

  if (json.status !== '1' || !Array.isArray(json.result)) {
    return [];
  }

  // Deduplicate by contract address
  const seen = new Set<string>();
  const unique: BscScanTokenTx[] = [];
  for (const tx of json.result) {
    const addr = tx.contractAddress.toLowerCase();
    if (!seen.has(addr)) {
      seen.add(addr);
      unique.push(tx);
    }
  }

  return unique;
}

// ---------------------------------------------------------------------------
// On-chain: read actual balances
// ---------------------------------------------------------------------------

/**
 * Read the on-chain balance of a single BEP-20 token for a wallet.
 * Returns null if the contract call fails (e.g. non-standard token).
 */
export async function getTokenBalance(
  provider: JsonRpcProvider | FallbackProvider,
  tokenAddress: string,
  walletAddress: string,
): Promise<{ balance: bigint; decimals: number; symbol: string; name: string } | null> {
  try {
    const contract = new Contract(tokenAddress, ERC20_ABI, provider);
    const [balance, decimals, symbol, name] = await Promise.all([
      contract.balanceOf(walletAddress) as Promise<bigint>,
      contract.decimals() as Promise<bigint>,
      contract.symbol() as Promise<string>,
      contract.name() as Promise<string>,
    ]);
    return {
      balance,
      decimals: Number(decimals),
      symbol,
      name,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CoinGecko: price lookup
// ---------------------------------------------------------------------------

/**
 * Fetch USD prices for a list of token contract addresses on BSC.
 * Returns a map of lowercase address → price in USD.
 * Uses CoinGecko's free /simple/token_price endpoint.
 */
export async function getTokenPrices(
  contractAddresses: string[],
  apiKey?: string,
): Promise<Record<string, number>> {
  if (contractAddresses.length === 0) return {};

  // CoinGecko limits to ~100 addresses per call
  const batchSize = 100;
  const prices: Record<string, number> = {};

  for (let i = 0; i < contractAddresses.length; i += batchSize) {
    const batch = contractAddresses.slice(i, i + batchSize);
    const addressList = batch.map((a) => a.toLowerCase()).join(',');

    const url = new URL(`${COINGECKO_API_URL}/simple/token_price/binance-smart-chain`);
    url.searchParams.set('contract_addresses', addressList);
    url.searchParams.set('vs_currencies', 'usd');
    if (apiKey) {
      url.searchParams.set('x_cg_demo_api_key', apiKey);
    }

    try {
      const res = await fetch(url.toString());
      const json = (await res.json()) as Record<string, { usd?: number }>;
      for (const [addr, data] of Object.entries(json)) {
        if (data.usd != null) {
          prices[addr.toLowerCase()] = data.usd;
        }
      }
    } catch {
      // CoinGecko rate limit or network error — continue with what we have
    }
  }

  return prices;
}

/**
 * Fetch BNB price in USD from CoinGecko.
 */
export async function getBnbPriceUsd(apiKey?: string): Promise<number> {
  const url = new URL(`${COINGECKO_API_URL}/simple/price`);
  url.searchParams.set('ids', 'binancecoin');
  url.searchParams.set('vs_currencies', 'usd');
  if (apiKey) {
    url.searchParams.set('x_cg_demo_api_key', apiKey);
  }

  try {
    const res = await fetch(url.toString());
    const json = (await res.json()) as { binancecoin?: { usd?: number } };
    return json.binancecoin?.usd ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator: full token scan
// ---------------------------------------------------------------------------

/**
 * Scan a wallet for all BEP-20 tokens with balances and USD values.
 *
 * Flow:
 * 1. Discover tokens via BSCScan tokentx
 * 2. Read on-chain balances (filters out zero balances)
 * 3. Fetch USD prices from CoinGecko
 * 4. Return TokenInfo[] sorted by value descending
 */
export async function scanTokens(
  provider: JsonRpcProvider | FallbackProvider,
  walletAddress: string,
  bscscanApiKey: string,
  coingeckoApiKey?: string,
): Promise<TokenInfo[]> {
  // 1. Discover token contracts
  const discovered = await discoverTokens(walletAddress, bscscanApiKey);

  // 2. Read on-chain balances in parallel (batches of 10 to avoid rate limits)
  const batchSize = 10;
  const tokenData: {
    address: string;
    balance: bigint;
    decimals: number;
    symbol: string;
    name: string;
  }[] = [];

  for (let i = 0; i < discovered.length; i += batchSize) {
    const batch = discovered.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((t) => getTokenBalance(provider, t.contractAddress, walletAddress)),
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result && result.balance > 0n) {
        tokenData.push({
          address: batch[j].contractAddress,
          ...result,
        });
      }
    }
  }

  // 3. Fetch prices
  const addresses = tokenData.map((t) => t.address);
  const prices = await getTokenPrices(addresses, coingeckoApiKey);

  // 4. Build TokenInfo[]
  const tokens: TokenInfo[] = tokenData.map((t) => {
    const addrLower = t.address.toLowerCase();
    const balanceFormatted = parseFloat(formatUnits(t.balance, t.decimals));
    const priceUsd = prices[addrLower] ?? 0;
    const valueUsd = balanceFormatted * priceUsd;

    return {
      address: t.address,
      symbol: TOKEN_SYMBOL_MAP[addrLower] ?? t.symbol,
      name: t.name,
      decimals: t.decimals,
      balance: t.balance.toString(),
      balanceFormatted,
      priceUsd,
      valueUsd,
      logoUrl: undefined,
    };
  });

  // Sort by USD value descending
  tokens.sort((a, b) => b.valueUsd - a.valueUsd);

  return tokens;
}
