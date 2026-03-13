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
} from './data/defillama.js';

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

function buildPoolOpportunities(pools: DefiLlamaPool[]): PoolOpportunity[] {
  return pools.slice(0, 5).map((pool, index) => ({
    poolId: pool.pool,
    symbol: pool.symbol,
    apy: pool.apy,
    apyBase: pool.apyBase ?? 0,
    apyReward: pool.apyReward ?? 0,
    tvlUsd: pool.tvlUsd,
    ilRisk: classifyIlRisk(pool),
    poolType: classifyPoolType(pool),
    underlyingTokens: pool.underlyingTokens ?? [],
    isHighlighted: index < 3,
  }));
}

function buildTvlChart(
  tvlHistory: Array<{ date: number; tvl: number }>,
): ChartConfig {
  const recent = tvlHistory.slice(-30);
  return {
    title: 'TVL (30d)',
    type: 'line',
    labels: recent.map((e) => new Date(e.date * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
    datasets: [{
      label: 'TVL USD',
      data: recent.map((e) => Math.round(e.tvl)),
      color: '#F0B90B',
    }],
  };
}

function buildApyChart(
  histories: Array<Array<{ timestamp: number; apy: number; tvlUsd: number }>>,
  pools: DefiLlamaPool[],
): ChartConfig {
  const labels = histories[0]?.map((e) =>
    new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  ) ?? [];

  const colors = ['#F0B90B', '#0ECB81', '#1890FF'];
  const datasets = histories.slice(0, 3).map((history, i) => ({
    label: pools[i]?.symbol ?? `Pool ${i + 1}`,
    data: history.map((e) => Math.round(e.apy * 100) / 100),
    color: colors[i] ?? '#888888',
  }));

  return { title: 'APY (30d)', type: 'line', labels, datasets };
}

function buildVolumeChart(pools: DefiLlamaPool[]): ChartConfig {
  const top5 = pools.slice(0, 5);
  return {
    title: '24h Volume by Pool',
    type: 'bar',
    labels: top5.map((p) => p.symbol),
    datasets: [{
      label: '24h Volume USD',
      data: top5.map((p) => Math.round(p.volumeUsd1d ?? 0)),
      color: '#1890FF',
    }],
  };
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

  const protocols = await getTopProtocolsByCategory(category, 10);
  const summary: CategorySummary = { category, protocols, lastUpdated: Date.now() };

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

  // Fetch pools and protocol detail concurrently
  const [rawPools, detail] = await Promise.all([
    getPoolsForProtocol(slug, 5),
    fetchProtocolDetail(slug),
  ]);

  const tvlHistory = detail?.tvlHistory ?? [];
  const isAudited = detail?.isAudited ?? false;

  // Get pool histories for top 3 pools (for charts) — in parallel, capped by request queue
  const top3Pools = rawPools.slice(0, 3);
  const histories = await Promise.all(
    top3Pools.map((p) => fetchPoolHistory(p.pool)),
  );

  const pools = buildPoolOpportunities(rawPools);

  // Build charts
  const charts: ChartConfig[] = [];
  if (tvlHistory.length > 0) charts.push(buildTvlChart(tvlHistory));
  if (histories.some((h) => h.length > 0)) charts.push(buildApyChart(histories, top3Pools));
  if (rawPools.some((p) => (p.volumeUsd1d ?? 0) > 0)) charts.push(buildVolumeChart(rawPools));

  const risk = buildRiskAssessment(isAudited, tvlHistory, Date.now() - 365 * 24 * 60 * 60 * 1000);

  // Derive basic protocol info
  const protocolName = slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ');
  const latestTvl = tvlHistory[tvlHistory.length - 1]?.tvl ?? rawPools.reduce((s, p) => s + p.tvlUsd, 0);

  const strategyBrief = await generateStrategyBrief(protocolName, pools, risk, userProfile);

  const report: DeepDiveReport = {
    protocolSlug: slug,
    protocolName,
    category: 'other', // caller can override from registry if needed
    tvlUsd: latestTvl,
    volume24h: rawPools.reduce((s, p) => s + (p.volumeUsd1d ?? 0), 0),
    generatedAt: Date.now(),
    pools,
    strategyBrief,
    charts,
    risk,
  };

  deepDiveCache.set(slug, { report, expiresAt: Date.now() + DEEP_DIVE_CACHE_TTL });
  return report;
}
