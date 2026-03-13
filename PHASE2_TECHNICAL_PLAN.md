# PHASE 2 — Research Section: Technical Plan (v2)

**Modification from PHASE2_RESEARCH_PLAN.md:**
Deep dive shows up to **5 pools** per protocol. Top 3 are "Best Opportunities" (agent-highlighted). The remaining 2 are "Other Pools" (displayed below, no recommendation — user decides).

---

## 1. What Exists Today

### packages/ai/src/research.ts (current)
- `runResearch()` — fetches CoinGecko BNB price + returns **hardcoded** farm data
- `getLatestReport()`, `isReportFresh()`, `startResearchLoop()`
- **No DeFiLlama calls. No protocol categories. No deep dive.**

### packages/server/src/index.ts (current research endpoints)
- `GET /api/research/latest` — returns latest `ResearchReport`
- `POST /api/research/run` — triggers `runResearch()`
- **No category endpoints. No protocol deep dive. No discovery.**

### packages/core/src/types.ts (current research types)
- `ResearchReport`, `FarmOpportunity`, `RiskAlert`, `MarketOverview` — present
- **Missing:** `DeepDiveReport`, `ProtocolEntry`, `PoolOpportunity`, `ChartConfig`, `ProtocolCategory`, `DiscoveryResult`, `CategorySummary`, `BraveSearchResult`

---

## 2. New Types — packages/core/src/types.ts

Add after the existing `ResearchReport` block. No existing types are changed.

```typescript
export type ProtocolCategory = 'dex' | 'lending' | 'lp' | 'yield' | 'other';

export interface DefiLlamaPool {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number;
  apyBase: number | null;
  apyReward: number | null;
  il7d: number | null;
  volumeUsd1d: number | null;
  underlyingTokens: string[] | null;
}

export interface PoolOpportunity {
  poolId: string;
  symbol: string;
  apy: number;
  apyBase: number;
  apyReward: number;
  tvlUsd: number;
  ilRisk: 'none' | 'low' | 'medium' | 'high';
  poolType: 'lp' | 'lending' | 'staking' | 'yield';
  underlyingTokens: string[];
  isHighlighted: boolean;   // true = top-3 "Best Opportunity"; false = "Other Pool"
}

export interface ChartDataset {
  label: string;
  data: number[];
  color: string;
}

export interface ChartConfig {
  title: string;
  type: 'line' | 'bar';
  labels: string[];
  datasets: ChartDataset[];
}

export interface ProtocolRisk {
  isAudited: boolean;
  contractVerified: boolean;
  tvlTrend: 'growing' | 'stable' | 'declining';
  ageMonths: number;
  liquidityDepth: 'deep' | 'moderate' | 'shallow';
  flags: string[];
}

export interface DeepDiveReport {
  protocolSlug: string;
  protocolName: string;
  category: ProtocolCategory;
  tvlUsd: number;
  volume24h: number;
  generatedAt: number;
  pools: PoolOpportunity[];     // 3–5 entries; first 3 isHighlighted=true
  strategyBrief: string;        // Claude-generated or template fallback
  charts: ChartConfig[];        // max 3: TVL, APY, Volume — returned as JSON
  risk: ProtocolRisk;
}

export interface ProtocolEntry {
  name: string;
  slug: string;
  category: ProtocolCategory;
  chain: string;
  tvlUsd: number;
  volume24h: number;
  website?: string;
  contractAddresses: string[];
  discoveredAt: number;
  source: 'defillama' | 'brave' | 'manual';
  verified: boolean;            // false = Brave-only find, not on DeFiLlama
  lastResearched: number | null;
}

export interface CategorySummary {
  category: ProtocolCategory;
  protocols: ProtocolEntry[];
  lastUpdated: number;
}

export interface DiscoveryResult {
  newProtocols: ProtocolEntry[];
  totalScanned: number;
  lastRunAt: number;
}

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}
```

Also add `'brave'` to `ApiService`:
```typescript
export type ApiService = 'bscscan' | 'birdeye' | 'defi_llama' | 'ankr' | 'quicknode' | 'coingecko' | 'brave';
```

---

## 3. New Files — Exact Function Signatures

### packages/ai/src/data/defillama.ts

**Fix #1 — Per-endpoint per-slug cache + request queue:**
```typescript
// Cache keys: 'protocols', 'pools', `detail:${slug}`, `history:${poolId}`
// TTL: 15min for all entries
// Request queue: max 5 concurrent DeFiLlama HTTP requests at any time
//   Implemented as a simple promise-based semaphore (no external deps)
//   Any call that would exceed 5 concurrent waits for a slot
```

**Fix #3 — normalizeChain() helper (solves the ambiguity, not just a known risk):**
```typescript
/**
 * Normalize DeFiLlama chain strings to 'bsc'.
 * DeFiLlama uses 'Binance' on /protocols and 'BSC' on /yields/pools.
 * Pure function — no I/O.
 */
export function normalizeChain(chain: string): string
// Implementation: chain.toLowerCase().replace('binance', 'bsc')
// i.e. 'Binance' → 'bsc', 'BSC' → 'bsc', anything else → lowercase passthrough
// Usage: normalizeChain(entry.chain) === 'bsc' in every filter

/**
 * Fetch all BSC protocols. Caches 15min under key 'protocols'.
 */
export async function fetchAllProtocols(): Promise<ProtocolEntry[]>

/**
 * Fetch TVL history for a protocol slug.
 * Caches 15min under key `detail:${slug}`.
 * Returns null if slug not found.
 */
export async function fetchProtocolDetail(
  slug: string
): Promise<{ tvlHistory: Array<{ date: number; tvl: number }> } | null>

/**
 * Fetch ALL yield pools, filter to BSC client-side, cache result.
 * Fix #5: fetched once per 15min, BSC-only list stored in module cache.
 * Never re-fetches within a 15min window regardless of how many callers.
 * Cache key: 'pools'
 */
export async function fetchYieldPools(): Promise<DefiLlamaPool[]>

/**
 * Fetch 30-day APY+TVL history for a pool UUID.
 * Caches 15min under key `history:${poolId}`.
 * Returns [] on failure.
 */
export async function fetchPoolHistory(
  poolId: string
): Promise<Array<{ timestamp: number; apy: number; tvlUsd: number }>>

/**
 * Categorize a DeFiLlama protocol entry into our ProtocolCategory.
 * Pure function — no I/O.
 */
export function categorizeProtocol(protocol: {
  category?: string;
  name?: string;
}): ProtocolCategory

/**
 * Get top N protocols in a category, sorted by TVL desc.
 * Uses cached fetchAllProtocols().
 */
export async function getTopProtocolsByCategory(
  category: ProtocolCategory,
  limit?: number
): Promise<ProtocolEntry[]>

/**
 * Get all BSC yield pools for a protocol slug, sorted by APY desc.
 * Uses cached fetchYieldPools().
 */
export async function getPoolsForProtocol(
  slug: string,
  limit?: number
): Promise<DefiLlamaPool[]>

/**
 * Check if a slug exists in the DeFiLlama protocols list.
 * Used by discovery to verify Brave-found protocols.
 */
export async function isKnownProtocol(slug: string): Promise<boolean>
```

**Request queue (semaphore) — implemented inside defillama.ts:**
```typescript
// Internal semaphore — not exported
class RequestQueue {
  private running = 0;
  private readonly maxConcurrent = 5;
  private queue: Array<() => void> = [];

  async run<T>(fn: () => Promise<T>): Promise<T>
  // If running < maxConcurrent: increment running, execute fn, decrement, drain queue
  // Else: push a resolve callback to queue, await a Promise that resolves when a slot opens
}

const defiLlamaQueue = new RequestQueue();
// All fetch calls go through: defiLlamaQueue.run(() => fetch(...))
```

---

### packages/ai/src/data/brave-search.ts

```typescript
// BRAVE_API_KEY from process.env.BRAVE_API_KEY
// Monthly cap: 1500. Counter persisted to data/brave-usage.json
// Returns [] gracefully when key missing or cap hit — never throws

export async function searchWeb(query: string, count?: number): Promise<BraveSearchResult[]>
export async function searchNews(query: string, count?: number): Promise<BraveSearchResult[]>
export function getBraveUsage(): { count: number; monthlyLimit: number; remaining: number }
```

---

### packages/ai/src/discovery.ts

**Fix #4 — Brave noise filtering:**
Brave search returns blogs, scam tokens, ads. Protocol only added to registry if:
1. It appears on DeFiLlama (`isKnownProtocol(slug)` returns true) → `verified: true`
2. OR it has verifiable contract addresses that return non-empty bytecode → `verified: true`
3. Otherwise → added with `verified: false`, `source: 'brave'`

Unverified protocols:
- Are stored in the registry (visible in discovery feed)
- Are NOT eligible for auto-research
- Display a ⚠️ "Unverified" badge in the discovery feed
- The `GET /api/research/protocol/:slug` endpoint returns a 400 if the slug is unverified

```typescript
export async function discoverNewProtocols(): Promise<DiscoveryResult>
export function getRegistry(): ProtocolEntry[]
export function getRegistryEntry(slug: string): ProtocolEntry | null
export function getLastDiscoveryRun(): number | null
export function loadRegistry(): void
```

---

### packages/ai/src/research.ts (additions only)

Existing `runResearch()` / `getLatestReport()` / `isReportFresh()` / `startResearchLoop()` are **not changed**.

**Fix #2 — Claude strategy brief daily cap:**
```typescript
// Module-level counter (in-memory, resets on server restart — acceptable)
let strategyBriefCallsToday = 0;
let strategyBriefResetDay = new Date().toDateString();
const STRATEGY_BRIEF_DAILY_CAP = 10;

// Before calling Claude:
function canCallClaudeForBrief(): boolean {
  const today = new Date().toDateString();
  if (today !== strategyBriefResetDay) {
    strategyBriefCallsToday = 0;
    strategyBriefResetDay = today;
  }
  return strategyBriefCallsToday < STRATEGY_BRIEF_DAILY_CAP;
}

// Template fallback (used when cap hit OR no API key):
function templateStrategyBrief(report: Partial<DeepDiveReport>): string
// Returns: "${name} offers up to ${topApy}% APY on ${topSymbol} (TVL: $${tvl}).
//   Lowest-risk option: ${lowestRiskPool}. Consider your risk tolerance before entering."
```

**New exports:**
```typescript
export async function researchCategory(category: ProtocolCategory): Promise<CategorySummary>
// Caches result 15min in-memory per category

export async function researchProtocol(slug: string, userProfile?: UserProfile): Promise<DeepDiveReport>
// Caches DeepDiveReport 30min in-memory per slug
// Strategy brief: calls Claude if canCallClaudeForBrief() && ANTHROPIC_API_KEY set
//   Uses claude-haiku-4-5, max_tokens: 256
//   Otherwise: templateStrategyBrief()
```

---

## 4. New Server Endpoints

```
GET  /api/research/categories          → { categories: [{ name, count }] }
GET  /api/research/category/:name      → CategorySummary
GET  /api/research/protocol/:slug      → DeepDiveReport (400 if verified=false)
POST /api/research/discover            → DiscoveryResult
GET  /api/research/discoveries         → { protocols: ProtocolEntry[], lastRunAt: number|null }
```

---

## 5. packages/ai/src/index.ts — New Exports

```typescript
export { researchCategory, researchProtocol } from './research.js';
export { discoverNewProtocols, getRegistry, getRegistryEntry, getLastDiscoveryRun } from './discovery.js';
```

---

## 6. Dashboard — Chart Rendering

**Fix #6 — Charts as JSON, one reusable client-side renderer:**

The API returns chart data as plain JSON inside `DeepDiveReport.charts: ChartConfig[]`.
The dashboard has ONE function that takes that JSON and renders it:

```javascript
// Client-side only — inside DASHBOARD_HTML <script> tag
function renderChart(canvasId, chartConfig) {
  var ctx = document.getElementById(canvasId).getContext('2d');
  // Destroy existing chart on that canvas if any (Chart.js requirement)
  if (window._charts && window._charts[canvasId]) {
    window._charts[canvasId].destroy();
  }
  if (!window._charts) window._charts = {};
  window._charts[canvasId] = new Chart(ctx, {
    type: chartConfig.type,
    data: {
      labels: chartConfig.labels,
      datasets: chartConfig.datasets.map(function(ds) {
        return {
          label: ds.label,
          data: ds.data,
          borderColor: ds.color,
          backgroundColor: ds.color + '33',  // 20% opacity fill
          tension: 0.3,
          fill: chartConfig.type === 'line'
        };
      })
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { x: { ticks: { maxTicksLimit: 6 } } }
    }
  });
}
```

No chart strings or configs are embedded in the HTML template. All chart data comes from the API response JSON. The `renderDeepDive(report)` function calls `renderChart('chart-0', report.charts[0])` etc.

Chart.js loaded via CDN in `<head>`:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
```

**Research panel structure:**
```
[DEX] [Lending] [LP] [Yield Farming] [Discover]  ← tabs

#view-category (shown when tab selected):
  "TOP PROTOCOLS IN DEX"            [Refresh ↺]
  protocol rows: name | TVL | 24h Vol | [Dive →]

#view-deepdive (shown when [Dive] clicked):
  [← Back]  PANCAKESWAP — DEEP DIVE
  ┌─ BEST OPPORTUNITIES ──────────────────────┐
  │ 1. CAKE-BNB LP   28.5% APY  TVL $45M  IL: medium  │
  │ 2. USDT-BNB LP   18.2% APY  TVL $120M IL: low     │
  │ 3. CAKE Staking  12.5% APY  TVL $80M  IL: none    │
  └───────────────────────────────────────────┘
  ┌─ OTHER POOLS ─────────────────────────────┐
  │ 4. BNB-BUSD LP   9.1% APY   TVL $60M  IL: low     │
  │ 5. ETH-BNB LP    7.4% APY   TVL $30M  IL: medium  │
  └───────────────────────────────────────────┘
  ┌─ STRATEGY BRIEF ──────────────────────────┐
  │ [Claude or template text]                 │
  └───────────────────────────────────────────┘
  ┌─ CHARTS ──────────────────────────────────┐
  │ [canvas: chart-0] [canvas: chart-1] [canvas: chart-2] │
  └───────────────────────────────────────────┘
  ┌─ RISK ASSESSMENT ─────────────────────────┐
  │ Audited: ✅  TVL Trend: ↑ Growing  Age: Xmo │
  │ Verified: ✅  Liquidity: Deep              │
  └───────────────────────────────────────────┘

#view-discover:
  [Scan Now]  Last: 2h ago
  🆕 NewProtocol.fi — Lending — Found 3h ago  TVL $1.2M  [Research →]
  ⚠️ UnverifiedDex — DEX — Found 1d ago  Unverified  [Skip]
```

---

## 7. Implementation Order

| Step | File | Depends On |
|------|------|------------|
| 1 | `packages/core/src/types.ts` — add new types | nothing |
| 2 | `packages/ai/src/data/defillama.ts` — new file (incl. normalizeChain + queue) | core types |
| 3 | `packages/ai/src/data/brave-search.ts` — new file | core types |
| 4 | `packages/ai/src/discovery.ts` — new file (incl. verification filter) | defillama, brave |
| 5 | `packages/ai/src/research.ts` — add researchCategory + researchProtocol (incl. daily cap) | defillama, discovery |
| 6 | `packages/ai/src/index.ts` — add exports | research, discovery |
| 7 | `packages/server/src/index.ts` — 5 new endpoints | ai exports |
| 8 | `packages/server/src/index.ts` — research panel HTML rewrite (incl. renderChart) | new endpoints |

Typecheck after every step. Commit after every step.

---

## 8. Resolved Design Decisions

| Issue | Resolution |
|-------|------------|
| DeFiLlama chain filter ambiguity | `normalizeChain()` helper in defillama.ts normalizes 'Binance' and 'BSC' → 'bsc'. Used in every filter. |
| DeFiLlama high call volume | Per-endpoint per-slug cache with 15min TTL. Request queue caps 5 concurrent calls. |
| Pools response size | `fetchYieldPools()` fetches once, caches BSC-filtered list for 15min. All callers share one cached result. |
| Claude brief cost | Hard cap: 10/day. Counter resets at midnight. After cap: template brief using live data. |
| Brave search noise | Brave finds only admitted if also on DeFiLlama OR has verified contracts. Otherwise stored as `verified: false`. Auto-research blocked for unverified entries. |
| Chart rendering | API returns `ChartConfig[]` as JSON. Single `renderChart(canvasId, config)` function client-side. No chart logic in HTML template. |

---

## 9. Files to Create/Modify

### New Files
- `packages/ai/src/data/defillama.ts`
- `packages/ai/src/data/brave-search.ts`
- `packages/ai/src/discovery.ts`
- `data/protocol-registry.json` (auto-created at runtime)
- `data/brave-usage.json` (auto-created at runtime)

### Modified Files
- `packages/core/src/types.ts` (+~100 lines)
- `packages/ai/src/research.ts` (+~150 lines, no removals)
- `packages/ai/src/index.ts` (+2 export lines)
- `packages/server/src/index.ts` (+5 endpoints + research panel HTML rewrite)
- `.env.example` (add BRAVE_API_KEY)
- `progress.txt` (update after completion)

### NOT Modified
- `packages/ai/src/agent.ts`
- `packages/ai/src/tools/*`
- Any package outside `ai`, `core`, `server`
