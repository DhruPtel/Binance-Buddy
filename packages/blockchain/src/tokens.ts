// =============================================================================
// @binancebuddy/blockchain — Token Scanner
// On-chain balances via Multicall3, prices via CoinGecko. Zero paid APIs needed.
// =============================================================================

import { Contract, Interface, AbiCoder } from 'ethers';
import type { JsonRpcProvider, FallbackProvider } from 'ethers';
import type { TokenInfo } from '@binancebuddy/core';
import {
  MULTICALL3_ADDRESS,
  COINGECKO_API_URL,
  SAFE_TOKENS,
  TOKEN_SYMBOL_MAP,
} from '@binancebuddy/core';
import { rateLimiter } from './rate-limiter.js';

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------

const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

const ERC20_IFACE = new Interface(ERC20_ABI);

// All SAFE_TOKENS on BSC are 18 decimals
const SAFE_TOKEN_DECIMALS = 18;

// ---------------------------------------------------------------------------
// Multicall3: batch balanceOf calls into a single RPC request
// ---------------------------------------------------------------------------

async function getBalancesMulticall(
  provider: JsonRpcProvider | FallbackProvider,
  tokenAddresses: string[],
  walletAddress: string,
): Promise<(bigint | null)[]> {
  const multicall = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const callData = ERC20_IFACE.encodeFunctionData('balanceOf', [walletAddress]);

  const calls = tokenAddresses.map((target) => ({
    target,
    allowFailure: true,
    callData,
  }));

  try {
    const results = (await multicall.aggregate3(calls)) as {
      success: boolean;
      returnData: string;
    }[];

    const abiCoder = AbiCoder.defaultAbiCoder();
    return results.map((r) => {
      if (!r.success || r.returnData === '0x' || r.returnData === '0x' + '0'.repeat(64)) {
        return null;
      }
      try {
        const [balance] = abiCoder.decode(['uint256'], r.returnData);
        return balance as bigint;
      } catch {
        return null;
      }
    });
  } catch {
    // Multicall failed (e.g. contract not deployed on testnet) — fall back to nulls
    return tokenAddresses.map(() => null);
  }
}

// ---------------------------------------------------------------------------
// On-chain: single token read (used by tests & one-offs)
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
// CoinGecko: price lookups
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
    if (apiKey) url.searchParams.set('x_cg_demo_api_key', apiKey);

    try {
      const cacheKey = `coingecko:prices:${batch.map((a) => a.toLowerCase()).sort().join(',')}`;
      const json = await rateLimiter.track(cacheKey, async () => {
        const r = await fetch(url.toString());
        return (await r.json()) as Record<string, { usd?: number }>;
      });
      for (const [addr, data] of Object.entries(json)) {
        if (data.usd != null) prices[addr.toLowerCase()] = data.usd;
      }
    } catch {
      // CoinGecko rate limit, network error, or daily cap — continue with what we have
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
  if (apiKey) url.searchParams.set('x_cg_demo_api_key', apiKey);

  try {
    const json = await rateLimiter.track('coingecko:bnbprice', async () => {
      const r = await fetch(url.toString());
      return (await r.json()) as { binancecoin?: { usd?: number } };
    });
    return json.binancecoin?.usd ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Token scan: Multicall3 balances for SAFE_TOKENS + CoinGecko prices
// Zero paid APIs required.
// ---------------------------------------------------------------------------

/**
 * Scan a wallet for popular BEP-20 token holdings.
 *
 * Uses Multicall3 to batch all balanceOf calls into a single RPC request,
 * then fetches USD prices from CoinGecko (free tier).
 * No API key required.
 */
export async function scanTokens(
  provider: JsonRpcProvider | FallbackProvider,
  walletAddress: string,
  coingeckoApiKey?: string,
): Promise<TokenInfo[]> {
  // Build ordered list of [symbol, address] from SAFE_TOKENS
  const entries = Object.entries(SAFE_TOKENS); // [[symbol, address], ...]
  const addresses = entries.map(([, addr]) => addr);

  // Batch all balanceOf calls in a single multicall
  const balances = await getBalancesMulticall(provider, addresses, walletAddress);

  // Filter to tokens with a non-zero balance
  const held: { symbol: string; address: string; balance: bigint }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const bal = balances[i];
    if (bal !== null && bal > 0n) {
      held.push({ symbol: entries[i][0], address: entries[i][1], balance: bal });
    }
  }

  if (held.length === 0) return [];

  // Fetch prices for held tokens from CoinGecko
  const prices = await getTokenPrices(
    held.map((t) => t.address),
    coingeckoApiKey,
  );

  const decimals = SAFE_TOKEN_DECIMALS;
  const divisor = 10 ** decimals;

  const tokens: TokenInfo[] = held.map((t) => {
    const addrLower = t.address.toLowerCase();
    const balanceFormatted = Number(t.balance) / divisor;
    const priceUsd = prices[addrLower] ?? 0;
    const valueUsd = balanceFormatted * priceUsd;

    return {
      address: t.address,
      symbol: TOKEN_SYMBOL_MAP[addrLower] ?? t.symbol,
      name: t.symbol, // for safe tokens, symbol === common name
      decimals,
      balance: t.balance.toString(),
      balanceFormatted,
      priceUsd,
      valueUsd,
      logoUrl: undefined,
    };
  });

  tokens.sort((a, b) => b.valueUsd - a.valueUsd);
  return tokens;
}
