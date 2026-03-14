// =============================================================================
// @binancebuddy/ai — GoldRush Data Client
// Provides fallback pool/price data via GoldRush (Covalent) API.
// Role: fallback when DeFiLlama yields endpoints return empty results.
//
// Features:
//   - 15min cache per request key
//   - Sequential request queue: 250ms gap (respects ~4 req/sec free tier)
//   - Returns empty arrays on failure (no API key, network error, API error)
// =============================================================================

import { GoldRushClient } from '@covalenthq/client-sdk';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const FETCH_DELAY_MS = 250;           // ~4 req/sec
const GOLDRUSH_BASE_URL = 'https://api.covalenthq.com';

// ---------------------------------------------------------------------------
// Cache — same pattern as defillama.ts
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Sequential request queue — one GoldRush request at a time, 250ms gap
// ---------------------------------------------------------------------------

let _queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function queued<T>(fn: () => Promise<T>): Promise<T> {
  const job = (_queue as Promise<void>).then(async () => {
    const result = await fn();
    await sleep(FETCH_DELAY_MS);
    return result;
  });
  _queue = job.catch(() => {});
  return job;
}

// ---------------------------------------------------------------------------
// Client factory — returns null if API key absent
// ---------------------------------------------------------------------------

function getClient(): GoldRushClient | null {
  const apiKey = process.env.GOLDRUSH_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoldRushClient(apiKey);
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface GoldRushTokenBalance {
  address: string;
  symbol: string;
  decimals: number;
  balance: string;    // raw bigint as string (matches core/types.ts pattern)
  priceUsd: number;
  valueUsd: number;
}

export interface GoldRushDexPool {
  poolAddress: string;
  token0Address: string;
  token1Address: string;
  token0Symbol: string;
  token1Symbol: string;
  totalLiquidityUsd: number;
  volume24hUsd: number;
}

export interface GoldRushPricePoint {
  date: number;       // unix ms timestamp
  priceUsd: number;
}

// ---------------------------------------------------------------------------
// getTokenBalances — ERC-20 + native token balances for a wallet address
// ---------------------------------------------------------------------------

export async function getTokenBalances(
  chain: string,
  address: string,
): Promise<GoldRushTokenBalance[]> {
  const key = `balances:${chain}:${address}`;
  const cached = cacheGet<GoldRushTokenBalance[]>(key);
  if (cached) return cached;

  const client = getClient();
  if (!client) return [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await queued(() => client.BalanceService.getTokenBalancesForWalletAddress(chain as any, address));
    if (result.error || !result.data) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: GoldRushTokenBalance[] = (result.data.items ?? []).map((item: any) => ({
      address: item.contract_address ?? '',
      symbol: item.contract_ticker_symbol ?? '',
      decimals: item.contract_decimals ?? 18,
      balance: (item.balance != null ? BigInt(item.balance) : BigInt(0)).toString(),
      priceUsd: item.quote_rate ?? 0,
      valueUsd: item.quote ?? 0,
    }));

    cacheSet(key, items);
    return items;
  } catch (err) {
    console.error(`[goldrush] getTokenBalances(${chain}, ${address}) error:`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// getDexPools — pool list for a DEX via xy=k REST endpoint
// Uses direct fetch: XYK service not present in SDK v3.
// Returns [] silently on 4xx (Class B endpoint not unlocked on free tier).
// ---------------------------------------------------------------------------

interface RawXykPool {
  exchange: string;
  token_0: { contract_address: string; contract_ticker_symbol: string } | null;
  token_1: { contract_address: string; contract_ticker_symbol: string } | null;
  total_liquidity_quote: number | null;
  volume_24h_quote: number | null;
}

interface RawXykResponse {
  data: { items: RawXykPool[] } | null;
  error: boolean;
}

export async function getDexPools(
  chain: string,
  protocol: string,
): Promise<GoldRushDexPool[]> {
  const key = `pools:${chain}:${protocol}`;
  const cached = cacheGet<GoldRushDexPool[]>(key);
  if (cached) return cached;

  const apiKey = process.env.GOLDRUSH_API_KEY;
  if (!apiKey) return [];

  try {
    const url =
      `${GOLDRUSH_BASE_URL}/v1/${encodeURIComponent(chain)}/xy=k/${encodeURIComponent(protocol)}/pools/` +
      `?key=${apiKey}&page-size=20`;

    const res = await queued(() => fetch(url));

    // 4xx = Class B not unlocked or bad params — return [] without logging
    if (res.status >= 400 && res.status < 500) return [];
    if (!res.ok) throw new Error(`GoldRush XYK pools HTTP ${res.status}`);

    const json = (await res.json()) as RawXykResponse;
    if (json.error || !json.data?.items) return [];

    const pools: GoldRushDexPool[] = json.data.items.map((p) => ({
      poolAddress: p.exchange ?? '',
      token0Address: p.token_0?.contract_address ?? '',
      token1Address: p.token_1?.contract_address ?? '',
      token0Symbol: p.token_0?.contract_ticker_symbol ?? '',
      token1Symbol: p.token_1?.contract_ticker_symbol ?? '',
      totalLiquidityUsd: p.total_liquidity_quote ?? 0,
      volume24hUsd: p.volume_24h_quote ?? 0,
    }));

    cacheSet(key, pools);
    return pools;
  } catch (err) {
    console.error(`[goldrush] getDexPools(${chain}, ${protocol}) error:`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// getHistoricalPrices — 30-day daily price history for a token
// ---------------------------------------------------------------------------

export async function getHistoricalPrices(
  chain: string,
  tokenAddress: string,
): Promise<GoldRushPricePoint[]> {
  const key = `prices:${chain}:${tokenAddress}`;
  const cached = cacheGet<GoldRushPricePoint[]>(key);
  if (cached) return cached;

  const client = getClient();
  if (!client) return [];

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const result = await queued(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.PricingService.getTokenPrices(chain as any, 'USD' as any, tokenAddress, {
        from,
        to,
        pricesAtAsc: true,
      }),
    );
    if (result.error || !result.data) return [];

    const points: GoldRushPricePoint[] = [];
    for (const tokenData of result.data) {
      if (!tokenData?.items) continue;
      for (const item of tokenData.items) {
        if (!item?.date || item.price == null) continue;
        points.push({
          date: new Date(item.date).getTime(),
          priceUsd: item.price,
        });
      }
    }

    cacheSet(key, points);
    return points;
  } catch (err) {
    console.error(`[goldrush] getHistoricalPrices(${chain}, ${tokenAddress}) error:`, err);
    return [];
  }
}
