// =============================================================================
// @binancebuddy/blockchain — Token Scanner
// Fetches BEP-20 balances via Ankr Enhanced API.
// Prices included in Ankr response — no separate CoinGecko call needed for scan.
// CoinGecko helpers kept for BNB price and standalone price lookups.
// =============================================================================

import { Contract, formatUnits } from 'ethers';
import type { JsonRpcProvider, FallbackProvider } from 'ethers';
import type { TokenInfo } from '@binancebuddy/core';
import {
  ANKR_MULTICHAIN_URL,
  COINGECKO_API_URL,
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
// Ankr response types
// ---------------------------------------------------------------------------

interface AnkrAsset {
  balance: string;            // human-readable (e.g. "1.23")
  balanceRawInteger: string;  // wei / smallest unit
  balanceUsd: string;
  blockchain: string;
  contractAddress: string;
  holderAddress: string;
  tokenDecimals: number;
  tokenName: string;
  tokenPrice: string;
  tokenSymbol: string;
  tokenType: string;
  thumbnail?: string;
}

interface AnkrBalanceResponse {
  jsonrpc: string;
  id: number;
  result?: {
    assets: AnkrAsset[];
    totalBalanceUsd: string;
    nextPageToken?: string;
  };
  error?: { code: number; message: string };
}

// ---------------------------------------------------------------------------
// On-chain: read actual balance for a single token (used by tests & one-offs)
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
// CoinGecko: standalone price lookups (kept for individual token queries)
// ---------------------------------------------------------------------------

/**
 * Fetch USD prices for a list of token contract addresses on BSC.
 * Returns a map of lowercase address → price in USD.
 */
export async function getTokenPrices(
  contractAddresses: string[],
  apiKey?: string,
): Promise<Record<string, number>> {
  if (contractAddresses.length === 0) return {};

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
// Ankr: full token scan via ankr_getAccountBalance
// ---------------------------------------------------------------------------

/**
 * Scan a wallet for all BEP-20 tokens with balances and USD values via Ankr.
 *
 * Ankr returns balances + prices in a single call — no secondary on-chain
 * reads or CoinGecko calls required. Returns TokenInfo[] sorted by value desc.
 */
export async function scanTokens(
  _provider: JsonRpcProvider | FallbackProvider,
  walletAddress: string,
  ankrApiKey?: string,
): Promise<TokenInfo[]> {
  const endpoint = ankrApiKey
    ? `${ANKR_MULTICHAIN_URL}/${ankrApiKey}`
    : ANKR_MULTICHAIN_URL;

  const body = {
    jsonrpc: '2.0',
    method: 'ankr_getAccountBalance',
    params: {
      walletAddress,
      blockchain: ['bsc'],
      onlyWhitelisted: false,
    },
    id: 1,
  };

  let assets: AnkrAsset[] = [];
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as AnkrBalanceResponse;
    assets = json.result?.assets ?? [];
  } catch {
    return [];
  }

  const tokens: TokenInfo[] = assets
    .filter((a) => a.tokenType === 'ERC20' || a.tokenType === 'BEP20')
    .map((a): TokenInfo => {
      const addrLower = a.contractAddress.toLowerCase();
      const balanceFormatted = parseFloat(a.balance) || 0;
      const priceUsd = parseFloat(a.tokenPrice) || 0;
      const valueUsd = parseFloat(a.balanceUsd) || 0;

      return {
        address: a.contractAddress,
        symbol: TOKEN_SYMBOL_MAP[addrLower] ?? a.tokenSymbol,
        name: a.tokenName,
        decimals: a.tokenDecimals,
        balance: a.balanceRawInteger,
        balanceFormatted,
        priceUsd,
        valueUsd,
        logoUrl: a.thumbnail,
      };
    })
    .filter((t) => t.balanceFormatted > 0);

  tokens.sort((a, b) => b.valueUsd - a.valueUsd);
  return tokens;
}
