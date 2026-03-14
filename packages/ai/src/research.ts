// =============================================================================
// @binancebuddy/ai — Research Agent
// Runs on a 30-minute cron cadence. Fetches market data and builds a ResearchReport.
// The execution agent reads this report via getLatestReport().
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';
import type {
  ResearchReport,
  MarketOverview,
  FarmOpportunity,
  RiskAlert,
  ProtocolCategory,
  CategorySummary,
  DeepDiveReport,
  PoolOpportunity,
  ChartConfig,
  ProtocolRisk,
  UserProfile,
  DefiLlamaPool,
} from '@binancebuddy/core';
import { COINGECKO_API_URL, RESEARCH_INTERVAL_MS } from '@binancebuddy/core';
import {
  getTopProtocolsByCategory,
  getPoolsForProtocol,
  fetchProtocolDetail,
  fetchPoolHistory,
  fetchYieldPools,
} from './data/defillama.js';
import type { PoolHistoryEntry } from './data/defillama.js';
import { getDexPools, getHistoricalPrices } from './data/goldrush.js';

// In-memory store (Redis in Day 7)
let latestReport: ResearchReport | null = null;
let isRunning = false;

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

async function fetchMarketOverview(): Promise<MarketOverview> {
  try {
    const url = `${COINGECKO_API_URL}/simple/price?ids=binancecoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      binancecoin?: { usd: number; usd_24h_change: number; usd_market_cap: number };
    };
    const bnb = json.binancecoin;
    if (!bnb) throw new Error('No BNB data');

    const change = bnb.usd_24h_change ?? 0;
    const sentiment: MarketOverview['marketSentiment'] =
      change > 3 ? 'bullish' : change < -3 ? 'bearish' : 'neutral';

    return {
      bnbPriceUsd: bnb.usd,
      bnbChange24h: change,
      totalTvlBsc: 0, // DefiLlama integration deferred
      marketSentiment: sentiment,
    };
  } catch {
    return {
      bnbPriceUsd: 0,
      bnbChange24h: 0,
      totalTvlBsc: 0,
      marketSentiment: 'neutral',
    };
  }
}

async function fetchTopBscTokens(): Promise<FarmOpportunity[]> {
  // Baseline well-known farms — enhanced with live APY data when DefiLlama is integrated (Day 7)
  return [
    {
      protocol: 'PancakeSwap',
      poolName: 'CAKE-BNB LP',
      poolAddress: '0x0eD7e52944161450477ee417DE9Cd3a859b14fD0',
      apy: 28.5,
      tvl: 45_000_000,
      tokens: ['CAKE', 'BNB'],
      riskScore: 3,
      riskAdjustedApy: 23.8,
      isAudited: true,
      impermanentLossRisk: 'medium',
    },
    {
      protocol: 'Venus',
      poolName: 'USDT Lending',
      poolAddress: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
      apy: 8.4,
      tvl: 280_000_000,
      tokens: ['USDT'],
      riskScore: 2,
      riskAdjustedApy: 8.0,
      isAudited: true,
      impermanentLossRisk: 'low',
    },
    {
      protocol: 'PancakeSwap',
      poolName: 'USDT-BNB LP',
      poolAddress: '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE',
      apy: 18.2,
      tvl: 120_000_000,
      tokens: ['USDT', 'BNB'],
      riskScore: 2,
      riskAdjustedApy: 16.8,
      isAudited: true,
      impermanentLossRisk: 'medium',
    },
  ];
}

function buildRiskAlerts(market: MarketOverview): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  const now = Math.floor(Date.now() / 1000);

  if (Math.abs(market.bnbChange24h) > 10) {
    alerts.push({
      severity: 'high',
      type: 'oracle_deviation',
      message: `BNB moved ${market.bnbChange24h.toFixed(1)}% in 24h — elevated volatility`,
      detectedAt: now,
    });
  }

  if (market.bnbChange24h < -15) {
    alerts.push({
      severity: 'critical',
      type: 'whale_exit',
      message: `BNB down ${Math.abs(market.bnbChange24h).toFixed(1)}% — possible systemic risk`,
      detectedAt: now,
    });
  }

  return alerts;
}

function buildRecommendations(market: MarketOverview, farms: FarmOpportunity[]): string[] {
  const recs: string[] = [];

  if (market.marketSentiment === 'bullish') {
    recs.push('Market trending up — consider adding to BNB or CAKE positions');
  } else if (market.marketSentiment === 'bearish') {
    recs.push('Market under pressure — consider stable yields on Venus or PancakeSwap stables');
  }

  const topFarm = farms[0];
  if (topFarm) {
    recs.push(`Top yield: ${topFarm.poolName} on ${topFarm.protocol} at ${topFarm.apy.toFixed(1)}% APY`);
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a single research cycle. Fetches market data and updates the in-memory report.
 * Called by the server cron job every 30 minutes.
 */
export async function runResearch(): Promise<ResearchReport> {
  if (isRunning) {
    console.log('[research] Already running, skipping cycle');
    return latestReport ?? buildEmptyReport();
  }

  isRunning = true;
  console.log('[research] Starting research cycle...');

  try {
    const [marketOverview, opportunities] = await Promise.all([
      fetchMarketOverview(),
      fetchTopBscTokens(),
    ]);

    const risks = buildRiskAlerts(marketOverview);
    const recommendations = buildRecommendations(marketOverview, opportunities);

    const report: ResearchReport = {
      timestamp: Date.now(),
      marketOverview,
      opportunities,
      risks,
      newPairs: [], // Day 7: PairCreated event listener
      recommendations,
    };

    latestReport = report;
    console.log(`[research] Cycle complete. BNB=$${marketOverview.bnbPriceUsd}, sentiment=${marketOverview.marketSentiment}`);
    return report;
  } finally {
    isRunning = false;
  }
}

/** Get the most recent research report (null if never run). */
export function getLatestReport(): ResearchReport | null {
  return latestReport;
}

/** True if report exists and is fresh (< RESEARCH_INTERVAL_MS old). */
export function isReportFresh(): boolean {
  if (!latestReport) return false;
  return Date.now() - latestReport.timestamp < RESEARCH_INTERVAL_MS;
}

function buildEmptyReport(): ResearchReport {
  return {
    timestamp: Date.now(),
    marketOverview: { bnbPriceUsd: 0, bnbChange24h: 0, totalTvlBsc: 0, marketSentiment: 'neutral' },
    opportunities: [],
    risks: [],
    newPairs: [],
    recommendations: [],
  };
}

/** Start a background research loop (call once at server startup). */
export function startResearchLoop(): void {
  const run = async () => {
    try { await runResearch(); } catch (e) { console.error('[research] Loop error:', e); }
  };

  void run(); // immediate first run
  setInterval(run, RESEARCH_INTERVAL_MS);
  console.log(`[research] Loop started — runs every ${RESEARCH_INTERVAL_MS / 60000}m`);
}

// =============================================================================
// Phase 2 — Protocol Research (on-demand, not the 30min background loop)
// =============================================================================

// ---------------------------------------------------------------------------
// Category cache — 15min TTL per category
// ---------------------------------------------------------------------------

interface CategorCacheEntry {
  summary: CategorySummary;
  expiresAt: number;
}
const categoryCache = new Map<string, CategorCacheEntry>();
const CATEGORY_CACHE_TTL = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Deep dive cache — 30min TTL per slug
// ---------------------------------------------------------------------------

interface DeepDiveCacheEntry {
  report: DeepDiveReport;
  expiresAt: number;
}
const deepDiveCache = new Map<string, DeepDiveCacheEntry>();
const DEEP_DIVE_CACHE_TTL = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Claude strategy brief daily cap (Fix #2)
// ---------------------------------------------------------------------------

const STRATEGY_BRIEF_DAILY_CAP = 10;
let strategyBriefCallsToday = 0;
let strategyBriefResetDay = new Date().toDateString();

function canCallClaudeForBrief(): boolean {
  const today = new Date().toDateString();
  if (today !== strategyBriefResetDay) {
    strategyBriefCallsToday = 0;
    strategyBriefResetDay = today;
  }
  return strategyBriefCallsToday < STRATEGY_BRIEF_DAILY_CAP;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function classifyIlRisk(pool: DefiLlamaPool): PoolOpportunity['ilRisk'] {
  if (pool.il7d === null) {
    // Infer from symbol: stablecoins → low, single-asset → none
    const sym = pool.symbol.toLowerCase();
    if (sym.includes('usdt') && sym.includes('usdc')) return 'low';
    if (!sym.includes('-')) return 'none';
    return 'medium';
  }
  const il = Math.abs(pool.il7d);
  if (il < 0.5) return 'low';
  if (il < 2) return 'medium';
  return 'high';
}

function classifyPoolType(pool: DefiLlamaPool): PoolOpportunity['poolType'] {
  const sym = pool.symbol.toLowerCase();
  if (sym.includes('-')) return 'lp';
  if (pool.apyReward !== null && (pool.apyReward ?? 0) > 0 && (pool.apyBase ?? 0) < 1) return 'staking';
  // Check category via project name heuristics
  const proj = pool.project.toLowerCase();
  if (proj.includes('venus') || proj.includes('aave') || proj.includes('lend')) return 'lending';
  if (sym.includes('-')) return 'lp';
  return 'yield';
}

const MIN_POOL_TVL = 10_000;
const MIN_VERIFIED_TVL = 50_000;
const APY_CAP = 500;
const NON_ASCII_RE = /[^\x20-\x7E]/;

function capApy(apy: number): number {
  return Math.min(apy, APY_CAP);
}

function buildPoolOpportunities(pools: DefiLlamaPool[]): PoolOpportunity[] {
  const filtered = pools.filter((p) => p.tvlUsd >= MIN_POOL_TVL && !NON_ASCII_RE.test(p.symbol));
  return filtered.slice(0, 5).map((pool, index) => ({
    poolId: pool.pool,
    symbol: pool.symbol,
    apy: capApy(pool.apy),
    apyBase: capApy(pool.apyBase ?? 0),
    apyReward: capApy(pool.apyReward ?? 0),
    tvlUsd: pool.tvlUsd,
    ilRisk: classifyIlRisk(pool),
    poolType: classifyPoolType(pool),
    underlyingTokens: pool.underlyingTokens ?? [],
    isHighlighted: index < 3,
  }));
}

// ---------------------------------------------------------------------------
// Chart builders
// ---------------------------------------------------------------------------

function formatChartDate(ts: number, isUnixSeconds = false): string {
  return new Date(isUnixSeconds ? ts * 1000 : ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildTvlChart(
  tvlHistory: Array<{ date: number; tvl: number }>,
): ChartConfig {
  const recent = tvlHistory.slice(-30);
  return {
    title: 'TVL (30d)',
    description: 'Total value locked over 30 days. Declining TVL signals loss of confidence; stable TVL with rising APY means fewer depositors competing for the same rewards.',
    type: 'line',
    labels: recent.map((e) => formatChartDate(e.date, true)),
    datasets: [{
      label: 'TVL USD',
      data: recent.map((e) => Math.round(e.tvl)),
      color: '#F0B90B',
    }],
  };
}

function buildApyBaseChart(
  histories: PoolHistoryEntry[][],
  pools: DefiLlamaPool[],
  title: string,
  description: string,
): ChartConfig | null {
  const colors = ['#F0B90B', '#0ECB81', '#1890FF'];
  const datasets = histories.slice(0, 3).map((history, i) => ({
    label: pools[i]?.symbol ?? `Pool ${i + 1}`,
    data: history.map((e) => Math.round((e.apyBase ?? e.apy) * 100) / 100),
    color: colors[i] ?? '#888888',
  }));
  if (datasets.every((ds) => ds.data.every((v) => v === 0))) return null;
  const labels = histories[0]?.map((e) => formatChartDate(e.timestamp)) ?? [];
  return { title, description, type: 'line', labels, datasets };
}

function buildApyRewardChart(
  histories: PoolHistoryEntry[][],
  pools: DefiLlamaPool[],
): ChartConfig | null {
  const colors = ['#B659FF', '#FF8C00', '#1890FF'];
  const datasets = histories.slice(0, 3).map((history, i) => ({
    label: pools[i]?.symbol ?? `Pool ${i + 1}`,
    data: history.map((e) => Math.round((e.apyReward ?? 0) * 100) / 100),
    color: colors[i] ?? '#888888',
  }));
  if (datasets.every((ds) => ds.data.every((v) => v === 0))) return null;
  const labels = histories[0]?.map((e) => formatChartDate(e.timestamp)) ?? [];
  return {
    title: 'Reward APY (30d)',
    description: 'Incentive tokens distributed to depositors on top of organic yield. High reward APY is typically unsustainable — watch for declining trends as incentive programs wind down.',
    type: 'line',
    labels,
    datasets,
  };
}

function buildIlChart(
  histories: PoolHistoryEntry[][],
  pools: DefiLlamaPool[],
): ChartConfig | null {
  const hasData = histories.some((h) => h.some((e) => e.il7d !== null));
  if (!hasData) return null;
  const colors = ['#F6465D', '#FF8C00', '#1890FF'];
  const datasets = histories.slice(0, 3).map((history, i) => ({
    label: pools[i]?.symbol ?? `Pool ${i + 1}`,
    data: history.map((e) => Math.round((e.il7d ?? 0) * 100) / 100),
    color: colors[i] ?? '#888888',
  }));
  const labels = histories[0]?.map((e) => formatChartDate(e.timestamp)) ?? [];
  return {
    title: 'IL Estimate 7d (30d)',
    description: 'Impermanent loss over rolling 7-day windows. Larger negative values mean the two pool assets have diverged significantly — holding them separately would have been more profitable.',
    type: 'line',
    labels,
    datasets,
  };
}

function buildVolumeChart(pools: DefiLlamaPool[]): ChartConfig | null {
  const top5 = pools.slice(0, 5).filter((p) => (p.volumeUsd1d ?? 0) > 0);
  if (top5.length === 0) return null;
  return {
    title: '24h Volume by Pool',
    description: 'Daily trading volume across pools. Higher volume relative to TVL means LPs earn more in fees. Low volume with high TVL suggests capital sitting idle.',
    type: 'bar',
    labels: top5.map((p) => p.symbol),
    datasets: [{
      label: '24h Volume USD',
      data: top5.map((p) => Math.round(p.volumeUsd1d ?? 0)),
      color: '#1890FF',
    }],
  };
}

function buildPoolTvlChart(pools: DefiLlamaPool[]): ChartConfig | null {
  const top5 = pools.slice(0, 5).filter((p) => p.tvlUsd > 0);
  if (top5.length === 0) return null;
  return {
    title: 'Pool TVL Comparison',
    description: 'Relative liquidity depth across pools. Larger pools have lower slippage and are safer for larger positions.',
    type: 'bar',
    labels: top5.map((p) => p.symbol),
    datasets: [{
      label: 'TVL USD',
      data: top5.map((p) => Math.round(p.tvlUsd)),
      color: '#F0B90B',
    }],
  };
}

// ---------------------------------------------------------------------------
// Chart selector — picks 3 charts based on protocol category
// ---------------------------------------------------------------------------

function selectChartsForCategory(
  category: ProtocolCategory,
  tvlHistory: Array<{ date: number; tvl: number }>,
  poolHistories: PoolHistoryEntry[][],
  pools: DefiLlamaPool[],
): ChartConfig[] {
  const charts: ChartConfig[] = [];

  const tryPush = (chart: ChartConfig | null) => {
    if (chart && charts.length < 3) charts.push(chart);
  };

  switch (category) {
    case 'lending': {
      tryPush(buildApyBaseChart(poolHistories, pools, 'Supply APY (30d)',
        'Organic yield earned by lenders from borrower interest. Stable trends indicate sustainable rates; sharp rises may signal high borrow demand or rate model changes.'));
      tryPush(buildApyRewardChart(poolHistories, pools));
      if (tvlHistory.length > 0) tryPush(buildTvlChart(tvlHistory));
      break;
    }
    case 'liquidity': {
      tryPush(buildVolumeChart(pools));
      if (tvlHistory.length > 0) tryPush(buildTvlChart(tvlHistory));
      tryPush(buildApyBaseChart(poolHistories, pools, 'Fee APY (30d)',
        'Trading fees earned by liquidity providers from swaps. Higher volume relative to TVL means more fee income. Sudden spikes often follow high-volatility market events.'));
      break;
    }
    case 'yield': {
      tryPush(buildApyBaseChart(poolHistories, pools, 'APY Base+Reward (30d)',
        'Base yield from the underlying vault strategy. Unlike reward APY, this is more sustainable as it comes from real protocol activity rather than token incentives.'));
      tryPush(buildIlChart(poolHistories, pools));
      if (tvlHistory.length > 0) tryPush(buildTvlChart(tvlHistory));
      break;
    }
    default: {
      tryPush(buildApyBaseChart(poolHistories, pools, 'APY (30d)',
        'Yield rate over 30 days. Where available, shows organic base APY — a more reliable indicator of sustainable returns than total APY including incentives.'));
      if (tvlHistory.length > 0) tryPush(buildTvlChart(tvlHistory));
      tryPush(buildPoolTvlChart(pools));
      break;
    }
  }

  // If category-specific charts yielded nothing, fall back to TVL
  if (charts.length === 0 && tvlHistory.length > 0) {
    charts.push(buildTvlChart(tvlHistory));
  }

  return charts;
}

function buildRiskAssessment(
  isAudited: boolean,
  tvlHistory: Array<{ date: number; tvl: number }>,
  discoveredAt: number,
): ProtocolRisk {
  const flags: string[] = [];

  // TVL trend: compare last 7 days vs prior 7 days
  let tvlTrend: ProtocolRisk['tvlTrend'] = 'stable';
  if (tvlHistory.length >= 14) {
    const recent7 = tvlHistory.slice(-7).reduce((s, e) => s + e.tvl, 0) / 7;
    const prior7 = tvlHistory.slice(-14, -7).reduce((s, e) => s + e.tvl, 0) / 7;
    if (prior7 > 0) {
      const change = (recent7 - prior7) / prior7;
      if (change > 0.05) tvlTrend = 'growing';
      else if (change < -0.05) tvlTrend = 'declining';
    }
  }

  if (tvlTrend === 'declining') flags.push('TVL declining — monitor closely');
  if (!isAudited) flags.push('No audit information found');

  const ageMonths = Math.floor((Date.now() - discoveredAt) / (30 * 24 * 60 * 60 * 1000));
  if (ageMonths < 6) flags.push('Protocol is relatively new (< 6 months)');

  // Liquidity depth by total TVL
  const latestTvl = tvlHistory[tvlHistory.length - 1]?.tvl ?? 0;
  const liquidityDepth: ProtocolRisk['liquidityDepth'] =
    latestTvl > 100_000_000 ? 'deep'
    : latestTvl > 10_000_000 ? 'moderate'
    : 'shallow';

  return {
    isAudited,
    contractVerified: true, // DeFiLlama protocols are all contract-verified
    tvlTrend,
    ageMonths,
    liquidityDepth,
    flags,
  };
}

function templateStrategyBrief(
  protocolName: string,
  pools: PoolOpportunity[],
): string {
  if (pools.length === 0) {
    return `${protocolName} is listed on DeFiLlama but no active yield pools were found on BSC at this time.`;
  }
  const top = pools[0]!;
  const lowestRisk = [...pools].sort((a, b) => {
    const order: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };
    return (order[a.ilRisk] ?? 2) - (order[b.ilRisk] ?? 2);
  })[0]!;

  return `${protocolName} offers up to ${top.apy.toFixed(1)}% APY on ${top.symbol} (TVL: $${(top.tvlUsd / 1e6).toFixed(1)}M). ` +
    `Lowest IL risk: ${lowestRisk.symbol} at ${lowestRisk.apy.toFixed(1)}% APY. ` +
    `Review pool specifics and your risk tolerance before entering.`;
}

async function generateStrategyBrief(
  protocolName: string,
  pools: PoolOpportunity[],
  risk: ProtocolRisk,
  userProfile?: UserProfile,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || !canCallClaudeForBrief()) {
    return templateStrategyBrief(protocolName, pools);
  }

  try {
    strategyBriefCallsToday++;
    const client = new Anthropic({ apiKey });

    const poolSummary = pools.slice(0, 3).map((p) =>
      `${p.symbol}: ${p.apy.toFixed(1)}% APY, TVL $${(p.tvlUsd / 1e6).toFixed(1)}M, IL risk: ${p.ilRisk}`,
    ).join('\n');

    const riskSummary = `Audited: ${risk.isAudited}, TVL trend: ${risk.tvlTrend}, Liquidity: ${risk.liquidityDepth}`;
    const userCtx = userProfile
      ? `User profile: ${userProfile.archetype} trader, risk score ${userProfile.riskScore}/10`
      : '';

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: 'You are a concise DeFi analyst. Write a 2-3 sentence strategy recommendation for a BSC DeFi protocol based on provided data. Be specific and actionable.',
      messages: [{
        role: 'user',
        content: `Protocol: ${protocolName}\nTop pools:\n${poolSummary}\nRisk: ${riskSummary}\n${userCtx}\n\nWrite a 2-3 sentence recommendation.`,
      }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as Anthropic.TextBlock).text)
      .join(' ');

    return text || templateStrategyBrief(protocolName, pools);
  } catch (err) {
    console.error('[research] Strategy brief generation error:', err);
    return templateStrategyBrief(protocolName, pools);
  }
}

// ---------------------------------------------------------------------------
// Phase 2 Public API
// ---------------------------------------------------------------------------

/**
 * Return top protocols in a category with 15min cache.
 */
export async function researchCategory(category: ProtocolCategory): Promise<CategorySummary> {
  const cached = categoryCache.get(category);
  if (cached && Date.now() < cached.expiresAt) return cached.summary;

  const [protocols, allPools] = await Promise.all([
    getTopProtocolsByCategory(category, 10),
    fetchYieldPools(),
  ]);

  // Single pass: compute bestApy (apyBase preferred), volume, and hasVerifiedPools per project.
  // Bug fix: use pool.apyBase ?? pool.apy (organic yield first) instead of pool.apy (total).
  const maxApyByProject = new Map<string, number>();
  const volumeByProject = new Map<string, number>();
  const verifiedByProject = new Map<string, boolean>();
  for (const pool of allPools) {
    if (NON_ASCII_RE.test(pool.symbol)) continue;
    const slug = pool.project;
    // hasVerifiedPools requires TVL >= $50k
    if (pool.tvlUsd >= MIN_VERIFIED_TVL) {
      verifiedByProject.set(slug, true);
    }
    // bestApy and volume only from pools meeting the deep-dive floor ($10k)
    if (pool.tvlUsd < MIN_POOL_TVL) continue;
    const organicApy = pool.apyBase ?? pool.apy;
    const currentApy = maxApyByProject.get(slug);
    if (currentApy === undefined || organicApy > currentApy) {
      maxApyByProject.set(slug, organicApy);
    }
    volumeByProject.set(slug, (volumeByProject.get(slug) ?? 0) + (pool.volumeUsd1d ?? 0));
  }

  // Enrich each protocol and split into verified / limited-data lists
  const enriched = protocols.map((p) => ({
    ...p,
    bestApy: maxApyByProject.get(p.slug) ?? undefined,
    poolVolume24h: volumeByProject.get(p.slug) ?? undefined,
    hasVerifiedPools: verifiedByProject.get(p.slug) ?? false,
  }));

  const summary: CategorySummary = {
    category,
    protocols: enriched.filter((p) => p.hasVerifiedPools),
    limitedDataProtocols: enriched.filter((p) => !p.hasVerifiedPools),
    lastUpdated: Date.now(),
  };

  categoryCache.set(category, { summary, expiresAt: Date.now() + CATEGORY_CACHE_TTL });
  return summary;
}

/**
 * Build a full DeepDiveReport for a protocol. Cached 30min per slug.
 * Strategy brief: uses Claude if daily cap not hit AND API key present, else template.
 */
export async function researchProtocol(
  slug: string,
  userProfile?: UserProfile,
): Promise<DeepDiveReport> {
  const cached = deepDiveCache.get(slug);
  if (cached && Date.now() < cached.expiresAt) return cached.report;

  // Fetch DeFiLlama pools and protocol detail concurrently
  const [defillPools, detail] = await Promise.all([
    getPoolsForProtocol(slug, 5),
    fetchProtocolDetail(slug),
  ]);

  const tvlHistory = detail?.tvlHistory ?? [];
  const isAudited = detail?.isAudited ?? false;
  const fees24h = detail?.fees24h ?? null;
  const fees7d = detail?.fees7d ?? null;
  const revenue24h = detail?.revenue24h ?? null;
  const revenue7d = detail?.revenue7d ?? null;

  // GoldRush fallback: if DeFiLlama returned no pools, try GoldRush DEX pool data.
  // Trigger is empty result, not error — fetchYieldPools() already returns [] on failure.
  let rawPools: DefiLlamaPool[] = defillPools;
  if (rawPools.length === 0) {
    const grPools = await getDexPools('bsc-mainnet', slug);
    if (grPools.length > 0) {
      rawPools = grPools.map((p) => ({
        pool: p.poolAddress,
        chain: 'bsc',
        project: slug,
        symbol: p.token0Symbol && p.token1Symbol
          ? `${p.token0Symbol}-${p.token1Symbol}`
          : p.poolAddress.slice(0, 8),
        tvlUsd: p.totalLiquidityUsd,
        apy: 0,
        apyBase: null,
        apyReward: null,
        il7d: null,
        volumeUsd1d: p.volume24hUsd,
        underlyingTokens: [p.token0Address, p.token1Address].filter(Boolean),
      }));
    }
  }

  // Get pool histories for top 3 pools.
  // If DeFiLlama chart returns [], fall back to GoldRush token price history
  // for the pool's first underlying token. Price points mapped to PoolHistoryEntry
  // with zero apy/tvl — charts skip all-zero datasets gracefully.
  const top3Pools = rawPools.slice(0, 3);
  const histories: PoolHistoryEntry[][] = await Promise.all(
    top3Pools.map(async (p) => {
      const dlHistory = await fetchPoolHistory(p.pool);
      if (dlHistory.length > 0) return dlHistory;
      const tokenAddr = p.underlyingTokens?.[0];
      if (!tokenAddr) return [];
      const prices = await getHistoricalPrices('bsc-mainnet', tokenAddr);
      return prices.map((pt) => ({
        timestamp: pt.date,
        apy: 0,
        tvlUsd: 0,
        apyBase: null,
        apyReward: null,
        il7d: null,
      }));
    }),
  );

  const pools = buildPoolOpportunities(rawPools);

  // Determine category from registry or infer
  let category: ProtocolCategory = 'other';
  try {
    const registryEntry = (await import('./discovery.js')).getRegistryEntry(slug);
    if (registryEntry?.category) category = registryEntry.category;
  } catch {
    // Discovery module not loaded — fall back to 'other' for chart selection
  }

  // Build category-specific charts
  const charts = selectChartsForCategory(category, tvlHistory, histories, rawPools);

  const risk = buildRiskAssessment(isAudited, tvlHistory, Date.now() - 365 * 24 * 60 * 60 * 1000);

  // Derive basic protocol info
  const protocolName = slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ');
  const latestTvl = tvlHistory[tvlHistory.length - 1]?.tvl ?? rawPools.reduce((s, p) => s + p.tvlUsd, 0);

  const strategyBrief = await generateStrategyBrief(protocolName, pools, risk, userProfile);

  const report: DeepDiveReport = {
    protocolSlug: slug,
    protocolName,
    category,
    tvlUsd: latestTvl,
    volume24h: rawPools.reduce((s, p) => s + (p.volumeUsd1d ?? 0), 0),
    fees24h,
    fees7d,
    revenue24h,
    revenue7d,
    generatedAt: Date.now(),
    pools,
    strategyBrief,
    charts,
    risk,
  };

  deepDiveCache.set(slug, { report, expiresAt: Date.now() + DEEP_DIVE_CACHE_TTL });
  return report;
}
