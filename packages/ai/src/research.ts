// =============================================================================
// @binancebuddy/ai — Research Agent
// Runs on a 30-minute cron cadence. Fetches market data and builds a ResearchReport.
// The execution agent reads this report via getLatestReport().
// =============================================================================

import type { ResearchReport, MarketOverview, FarmOpportunity, RiskAlert } from '@binancebuddy/core';
import { COINGECKO_API_URL, RESEARCH_INTERVAL_MS } from '@binancebuddy/core';

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
