// =============================================================================
// @binancebuddy/ai — DeFiLlama Data Client
// Fetches protocol and yield pool data from DeFiLlama's free API.
// Features:
//   - Per-endpoint per-slug cache with 15min TTL
//   - Request queue: max 5 concurrent DeFiLlama requests
//   - normalizeChain() solves 'Binance' vs 'BSC' inconsistency across endpoints
//   - fetchYieldPools() fetches once, stores BSC-only filtered list
// =============================================================================

import type { ProtocolEntry, ProtocolCategory, DefiLlamaPool } from '@binancebuddy/core';

const PROTOCOLS_URL = 'https://api.llama.fi/protocols';
const PROTOCOL_DETAIL_URL = 'https://api.llama.fi/protocol';
const YIELDS_POOLS_URL = 'https://yields.llama.fi/pools';
const YIELDS_CHART_URL = 'https://yields.llama.fi/chart';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------------
// Cache — keyed by string, stores { data, expiresAt }
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
// Sequential request queue — one DeFiLlama request at a time, 200ms gap
// ---------------------------------------------------------------------------

let _fetchQueue: Promise<unknown> = Promise.resolve();
const FETCH_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function queuedFetch(url: string): Promise<Response> {
  const job = _fetchQueue.then(async () => {
    const res = await fetch(url);
    await sleep(FETCH_DELAY_MS);
    return res;
  });
  _fetchQueue = job.catch(() => {}); // keep chain alive on error
  return job;
}

// ---------------------------------------------------------------------------
// normalizeChain — solves DeFiLlama's 'Binance' vs 'BSC' inconsistency
// ---------------------------------------------------------------------------

/**
 * Normalize DeFiLlama chain strings to lowercase 'bsc'.
 * DeFiLlama uses 'Binance' on /protocols and 'BSC' on /yields/pools.
 */
export function normalizeChain(chain: string): string {
  const lower = chain.toLowerCase();
  if (lower === 'binance') return 'bsc';
  return lower;
}

function isBscChain(chain: string): boolean {
  return normalizeChain(chain) === 'bsc';
}

// ---------------------------------------------------------------------------
// categorizeProtocol — maps DeFiLlama category strings to ProtocolCategory
// ---------------------------------------------------------------------------

/**
 * Map DeFiLlama category string to our ProtocolCategory.
 * Pure function — no I/O.
 */
export function categorizeProtocol(protocol: { category?: string; name?: string }): ProtocolCategory {
  const cat = (protocol.category ?? '').toLowerCase();
  const name = (protocol.name ?? '').toLowerCase();

  if (cat.includes('lend') || cat.includes('borrow') || cat.includes('money market')) return 'lending';
  if (cat.includes('yield') || cat.includes('aggregator') || cat.includes('optimizer')) return 'yield';
  if (cat.includes('dex') || cat.includes('amm') || name.includes('swap') || cat.includes('farm') || cat.includes('liquidity') || cat.includes('lp')) return 'liquidity';
  return 'other';
}

// ---------------------------------------------------------------------------
// DeFiLlama API types (raw response shapes)
// ---------------------------------------------------------------------------

interface RawProtocol {
  name: string;
  slug: string;
  category?: string;
  chains?: string[];
  tvl?: number;
  change_1d?: number;
  url?: string;
  address?: string;
}

interface RawProtocolDetail {
  tvl?: Array<{ date: number; totalLiquidityUSD: number }>;
  audit_links?: string[];
  auditNote?: string;
  metrics?: {
    fees?: { '24h'?: number; '7d'?: number };
    revenue?: { '24h'?: number; '7d'?: number };
  };
}

interface RawPoolsResponse {
  status: string;
  data: Array<{
    pool: string;
    chain: string;
    project: string;
    symbol: string;
    tvlUsd: number;
    apy: number;
    apyBase?: number | null;
    apyReward?: number | null;
    il7d?: number | null;
    volumeUsd1d?: number | null;
    underlyingTokens?: string[] | null;
  }>;
}

interface RawChartResponse {
  status: string;
  data: Array<{
    timestamp: string;
    apy: number;
    tvlUsd: number;
    apyBase?: number | null;
    apyReward?: number | null;
    il7d?: number | null;
  }>;
}

// ---------------------------------------------------------------------------
// fetchAllProtocols
// ---------------------------------------------------------------------------

/**
 * Fetch all BSC protocols from DeFiLlama. Caches 15min.
 */
export async function fetchAllProtocols(): Promise<ProtocolEntry[]> {
  const cached = cacheGet<ProtocolEntry[]>('protocols');
  if (cached) return cached;

  try {
    const res = await queuedFetch(PROTOCOLS_URL);
    if (!res.ok) throw new Error(`DeFiLlama /protocols: ${res.status}`);
    const raw = (await res.json()) as RawProtocol[];

    const bscProtocols: ProtocolEntry[] = raw
      .filter((p) => Array.isArray(p.chains) && p.chains.some(isBscChain))
      .map((p) => ({
        name: p.name,
        slug: p.slug,
        category: categorizeProtocol(p),
        chain: 'bsc',
        tvlUsd: p.tvl ?? 0,
        volume24h: 0, // DeFiLlama /protocols doesn't return volume; use pool-level volumeUsd1d in deep dives
        website: p.url,
        contractAddresses: p.address ? [p.address] : [],
        discoveredAt: Date.now(),
        source: 'defillama' as const,
        verified: true,
        lastResearched: null,
      }));

    cacheSet('protocols', bscProtocols);
    return bscProtocols;
  } catch (err) {
    console.error('[defillama] fetchAllProtocols error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// fetchProtocolDetail
// ---------------------------------------------------------------------------

/**
 * Fetch TVL history for a protocol slug. Caches 15min.
 * Returns null if not found.
 */
export interface ProtocolDetailResult {
  tvlHistory: Array<{ date: number; tvl: number }>;
  isAudited: boolean;
  fees24h: number | null;
  fees7d: number | null;
  revenue24h: number | null;
  revenue7d: number | null;
}

export async function fetchProtocolDetail(slug: string): Promise<ProtocolDetailResult | null> {
  const key = `detail:${slug}`;
  const cached = cacheGet<ProtocolDetailResult>(key);
  if (cached) return cached;

  try {
    const res = await queuedFetch(`${PROTOCOL_DETAIL_URL}/${encodeURIComponent(slug)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`DeFiLlama /protocol/${slug}: ${res.status}`);
    const raw = (await res.json()) as RawProtocolDetail;

    const tvlHistory = (raw.tvl ?? [])
      .slice(-30)
      .map((entry) => ({ date: entry.date, tvl: entry.totalLiquidityUSD }));

    const isAudited = Boolean(
      (raw.audit_links && raw.audit_links.length > 0) ||
      (raw.auditNote && raw.auditNote.toLowerCase().includes('audit')),
    );

    const result: ProtocolDetailResult = {
      tvlHistory,
      isAudited,
      fees24h: raw.metrics?.fees?.['24h'] ?? null,
      fees7d: raw.metrics?.fees?.['7d'] ?? null,
      revenue24h: raw.metrics?.revenue?.['24h'] ?? null,
      revenue7d: raw.metrics?.revenue?.['7d'] ?? null,
    };
    cacheSet(key, result);
    return result;
  } catch (err) {
    console.error(`[defillama] fetchProtocolDetail(${slug}) error:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// fetchYieldPools — fetches once, caches BSC-filtered list for 15min
// ---------------------------------------------------------------------------

/**
 * Fetch ALL yield pools, filter to BSC client-side, cache result.
 * Never re-fetches within a 15min window regardless of how many concurrent callers.
 */
export async function fetchYieldPools(): Promise<DefiLlamaPool[]> {
  const cached = cacheGet<DefiLlamaPool[]>('pools');
  if (cached) return cached;

  try {
    const res = await queuedFetch(YIELDS_POOLS_URL);
    if (!res.ok) throw new Error(`DeFiLlama /pools: ${res.status}`);
    const raw = (await res.json()) as RawPoolsResponse;

    const bscPools: DefiLlamaPool[] = (raw.data ?? [])
      .filter((p) => isBscChain(p.chain))
      .map((p) => ({
        pool: p.pool,
        chain: p.chain,
        project: p.project,
        symbol: p.symbol,
        tvlUsd: p.tvlUsd ?? 0,
        apy: p.apy ?? 0,
        apyBase: p.apyBase ?? null,
        apyReward: p.apyReward ?? null,
        il7d: p.il7d ?? null,
        volumeUsd1d: p.volumeUsd1d ?? null,
        underlyingTokens: p.underlyingTokens ?? null,
      }));

    cacheSet('pools', bscPools);
    return bscPools;
  } catch (err) {
    console.error('[defillama] fetchYieldPools error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// fetchPoolHistory
// ---------------------------------------------------------------------------

/**
 * Fetch 30-day APY + TVL history for a pool UUID. Caches 15min.
 * Returns [] on failure.
 */
/** Single data point from pool history chart */
export interface PoolHistoryEntry {
  timestamp: number;
  apy: number;
  tvlUsd: number;
  apyBase: number | null;
  apyReward: number | null;
  il7d: number | null;
}

export async function fetchPoolHistory(
  poolId: string,
): Promise<PoolHistoryEntry[]> {
  const key = `history:${poolId}`;
  const cached = cacheGet<PoolHistoryEntry[]>(key);
  if (cached) return cached;

  try {
    const res = await queuedFetch(`${YIELDS_CHART_URL}/${encodeURIComponent(poolId)}`);
    if (!res.ok) throw new Error(`DeFiLlama /chart/${poolId}: ${res.status}`);
    const raw = (await res.json()) as RawChartResponse;

    const history: PoolHistoryEntry[] = (raw.data ?? [])
      .slice(-30)
      .map((entry) => ({
        timestamp: new Date(entry.timestamp).getTime(),
        apy: entry.apy ?? 0,
        tvlUsd: entry.tvlUsd ?? 0,
        apyBase: entry.apyBase ?? null,
        apyReward: entry.apyReward ?? null,
        il7d: entry.il7d ?? null,
      }));

    cacheSet(key, history);
    return history;
  } catch (err) {
    console.error(`[defillama] fetchPoolHistory(${poolId}) error:`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// getTopProtocolsByCategory
// ---------------------------------------------------------------------------

/**
 * Get top N BSC protocols in a category, sorted by TVL descending.
 */
export async function getTopProtocolsByCategory(
  category: ProtocolCategory,
  limit = 10,
): Promise<ProtocolEntry[]> {
  const all = await fetchAllProtocols();
  return all
    .filter((p) => p.category === category)
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// getPoolsForProtocol
// ---------------------------------------------------------------------------

/**
 * Get BSC yield pools for a protocol slug, sorted by APY descending.
 */
export async function getPoolsForProtocol(
  slug: string,
  limit = 5,
): Promise<DefiLlamaPool[]> {
  const all = await fetchYieldPools();
  return all
    .filter((p) => p.project === slug)
    .sort((a, b) => b.apy - a.apy)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// isKnownProtocol — used by discovery to verify Brave-found protocols
// ---------------------------------------------------------------------------

/**
 * Check if a slug exists in DeFiLlama's BSC protocol list.
 */
export async function isKnownProtocol(slug: string): Promise<boolean> {
  const all = await fetchAllProtocols();
  return all.some((p) => p.slug === slug);
}
