// =============================================================================
// @binancebuddy/core — Shared Type Definitions
// ALL shared types live here. Other packages import from @binancebuddy/core.
// =============================================================================

// ---------------------------------------------------------------------------
// Wallet & Portfolio
// ---------------------------------------------------------------------------

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string; // bigint as string
  balanceFormatted: number;
  priceUsd: number;
  valueUsd: number;
  logoUrl?: string;
}

export interface WalletState {
  address: string;
  chainId: number;
  bnbBalance: string; // bigint as string
  bnbBalanceFormatted: number;
  tokens: TokenInfo[];
  totalValueUsd: number;
  lastScanned: number; // unix timestamp
}

// ---------------------------------------------------------------------------
// User Profile
// ---------------------------------------------------------------------------

export type TraderArchetype = 'newcomer' | 'holder' | 'swapper' | 'farmer' | 'degen' | 'unknown';
export type TradingFrequency = 'rare' | 'weekly' | 'daily' | 'hyperactive';

export interface ProtocolUsage {
  name: string;
  contractAddresses: string[];
  interactionCount: number;
  lastUsed: number; // unix timestamp
  category: 'dex' | 'lending' | 'farming' | 'nft' | 'bridge' | 'other';
}

export interface UserProfile {
  address: string;
  archetype: TraderArchetype;
  riskScore: number; // 1-10
  protocols: ProtocolUsage[];
  preferredTokens: string[]; // token addresses
  avgTradeSize: number; // in USD
  tradingFrequency: TradingFrequency;
  totalTxCount: number;
}

// ---------------------------------------------------------------------------
// Transaction History
// ---------------------------------------------------------------------------

export type TxCategory =
  | 'swap'
  | 'farm_enter'
  | 'farm_exit'
  | 'stake'
  | 'unstake'
  | 'transfer'
  | 'nft'
  | 'bridge'
  | 'approve'
  | 'snipe'
  | 'unknown';

export interface ParsedTransaction {
  hash: string;
  timestamp: number;
  blockNumber: number;
  from: string;
  to: string;
  value: string; // BNB value as string
  gasUsed: string;
  gasPrice: string;
  status: 'success' | 'failed';
  category: TxCategory;
  protocol?: string;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: string;
  amountOut?: string;
}

// ---------------------------------------------------------------------------
// Buddy / Tamagotchi
// ---------------------------------------------------------------------------

export type CreatureType = 'creature_a' | 'creature_b' | 'creature_c';
export type EvolutionStage = 'seedling' | 'sprout' | 'bloom' | 'guardian' | 'apex';
export type Mood = 'ecstatic' | 'happy' | 'neutral' | 'worried' | 'anxious';

export const XP_THRESHOLDS: Record<EvolutionStage, number> = {
  seedling: 0,
  sprout: 100,
  bloom: 500,
  guardian: 2000,
  apex: 5000,
};

export type XPSource =
  | 'trade_executed'
  | 'profitable_trade'
  | 'daily_checkin'
  | 'wallet_scan'
  | 'chat_interaction'
  | 'farm_entered'
  | 'snipe_success'
  | 'achievement_unlocked';

export interface BuddyState {
  creatureType: CreatureType;
  stage: EvolutionStage;
  xp: number;
  level: number;
  mood: Mood;
  moodReason: string;
  trenchesUnlocked: boolean;
  achievements: string[];
  lastInteraction: number; // unix timestamp
  totalInteractions: number;
  totalTradesExecuted: number;
  streakDays: number;
}

// ---------------------------------------------------------------------------
// Trading Mode & Guardrails
// ---------------------------------------------------------------------------

export type TradeMode = 'normal' | 'trenches';

export interface GuardrailConfig {
  maxTransactionValueBnb: number;
  maxSlippageBps: number;
  bnbFeeReserve: number;
  circuitBreakerThreshold: number;
  requireApprovalAboveBnb: number;
}

export interface SimulationResult {
  success: boolean;
  gasEstimate: string;
  revertReason?: string;
  outputAmount?: string;
}

export interface GuardrailResult {
  passed: boolean;
  failureReason?: string;
  simulation: SimulationResult;
  checks: {
    simulation: boolean;
    spendingLimit: boolean;
    riskGate: boolean;
    feeReserve: boolean;
    protocolAllowlist: boolean;
  };
}

// ---------------------------------------------------------------------------
// DEX / Trading
// ---------------------------------------------------------------------------

export interface SwapParams {
  tokenIn: string; // contract address
  tokenOut: string; // contract address
  amountIn: string; // bigint as string
  slippageBps: number;
  deadline?: number; // unix timestamp, default now + 20min
  recipient?: string; // defaults to connected wallet
}

export interface SwapQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  amountOutMin: string; // after slippage
  priceImpact: number; // percentage
  path: string[]; // route through tokens
  gasEstimate: string;
  gasCostBnb: string;
  gasCostUsd: number;
}

export interface SwapResult {
  success: boolean;
  txHash?: string;
  amountIn: string;
  amountOut: string;
  gasUsed?: string;
  error?: string;
}

export interface TokenApproval {
  tokenAddress: string;
  spenderAddress: string;
  currentAllowance: string;
  requiredAmount: string;
  needsApproval: boolean;
}

// ---------------------------------------------------------------------------
// Trade History
// ---------------------------------------------------------------------------

export interface TradeRecord {
  id: string;
  timestamp: number;
  type: 'swap' | 'farm_enter' | 'farm_exit' | 'snipe';
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  txHash: string;
  gasUsed: string;
  success: boolean;
  profitLoss?: number; // USD
  mode: TradeMode;
}

// ---------------------------------------------------------------------------
// Research Agent
// ---------------------------------------------------------------------------

export interface MarketOverview {
  bnbPriceUsd: number;
  bnbChange24h: number;
  totalTvlBsc: number;
  marketSentiment: 'bullish' | 'neutral' | 'bearish';
}

export interface RiskAlert {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'depeg' | 'liquidity_drain' | 'oracle_deviation' | 'whale_exit' | 'rug_signal';
  protocol?: string;
  tokenAddress?: string;
  message: string;
  detectedAt: number;
}

export interface NewPairInfo {
  pairAddress: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  createdAt: number;
  initialLiquidityBnb: number;
  isVerified: boolean;
  isLiquidityLocked: boolean;
  honeypotRisk: 'low' | 'medium' | 'high';
}

export interface FarmOpportunity {
  protocol: string;
  poolName: string;
  poolAddress: string;
  apy: number;
  tvl: number;
  tokens: string[];
  riskScore: number; // 1-10
  riskAdjustedApy: number;
  isAudited: boolean;
  impermanentLossRisk: 'low' | 'medium' | 'high';
}

export interface ResearchReport {
  timestamp: number;
  marketOverview: MarketOverview;
  opportunities: FarmOpportunity[];
  risks: RiskAlert[];
  newPairs: NewPairInfo[];
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// AI Agent
// ---------------------------------------------------------------------------

export type AgentRole = 'user' | 'buddy' | 'system' | 'tool';

export interface AgentMessage {
  id: string;
  timestamp: number;
  role: AgentRole;
  content: string;
  toolCall?: {
    name: string;
    params: Record<string, unknown>;
    result: Record<string, unknown>;
  };
  xpAwarded?: number;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  requiresTrenchesMode?: boolean;
  requiresApiKey?: string;
  handler: (params: Record<string, unknown>, context: AgentContext) => Promise<unknown>;
}

export interface AgentContext {
  walletState: WalletState;
  userProfile: UserProfile;
  buddyState: BuddyState;
  researchReport: ResearchReport | null;
  recentTrades: TradeRecord[];
  mode: TradeMode;
  guardrailConfig: GuardrailConfig;
}

export interface ExecutionResult {
  success: boolean;
  toolName?: string;
  output?: unknown;
  error?: string;
  xpAwarded: number;
  circuitBreakerTripped: boolean;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type AlertConditionType =
  | 'price_above'
  | 'price_below'
  | 'price_change_pct'
  | 'liquidity_below'
  | 'new_pair';

export interface AlertCondition {
  type: AlertConditionType;
  tokenAddress?: string;
  threshold: number;
  direction?: 'up' | 'down';
}

export interface Alert {
  id: string;
  condition: AlertCondition;
  active: boolean;
  createdAt: number;
  triggeredAt?: number;
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export type ApiService =
  | 'bscscan'
  | 'birdeye'
  | 'defi_llama'
  | 'ankr'
  | 'quicknode'
  | 'coingecko'
  | 'brave';

export interface ApiKeyRecord {
  service: ApiService;
  key: string; // AES-256 encrypted at rest
  addedAt: number;
  lastUsed: number;
  capabilities: string[];
}

// ---------------------------------------------------------------------------
// Phase 2 Research — Protocol & Deep Dive Types
// ---------------------------------------------------------------------------

export type ProtocolCategory = 'dex' | 'lending' | 'lp' | 'yield' | 'other';

/** Raw pool record from DeFiLlama /yields/pools */
export interface DefiLlamaPool {
  pool: string;             // pool UUID
  chain: string;
  project: string;          // protocol slug
  symbol: string;           // e.g. "CAKE-BNB"
  tvlUsd: number;
  apy: number;
  apyBase: number | null;
  apyReward: number | null;
  il7d: number | null;      // 7-day impermanent loss %
  volumeUsd1d: number | null;
  underlyingTokens: string[] | null;
}

/** One pool in a deep dive — 5 max, top 3 isHighlighted=true */
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
  isHighlighted: boolean;   // true = "Best Opportunity" (top 3), false = "Other Pool"
}

/** Dataset within a chart */
export interface ChartDataset {
  label: string;
  data: number[];
  color: string;
}

/** Chart config returned as JSON from the API, rendered client-side via Chart.js */
export interface ChartConfig {
  title: string;
  type: 'line' | 'bar';
  labels: string[];
  datasets: ChartDataset[];
}

/** Risk summary for a protocol */
export interface ProtocolRisk {
  isAudited: boolean;
  contractVerified: boolean;
  tvlTrend: 'growing' | 'stable' | 'declining';
  ageMonths: number;
  liquidityDepth: 'deep' | 'moderate' | 'shallow';
  flags: string[];
}

/** Full deep dive report returned by GET /api/research/protocol/:slug */
export interface DeepDiveReport {
  protocolSlug: string;
  protocolName: string;
  category: ProtocolCategory;
  tvlUsd: number;
  volume24h: number;
  generatedAt: number;
  pools: PoolOpportunity[];     // 3–5 entries; pools[0..2].isHighlighted = true
  strategyBrief: string;        // Claude-generated or template fallback
  charts: ChartConfig[];        // max 3: TVL history, APY history, Volume
  risk: ProtocolRisk;
}

/** Entry in the protocol registry (persisted to data/protocol-registry.json) */
export interface ProtocolEntry {
  name: string;
  slug: string;
  category: ProtocolCategory;
  chain: string;
  tvlUsd: number;
  volume24h: number;
  bestApy?: number;             // max APY across BSC yield pools for this protocol
  poolVolume24h?: number;       // sum of volumeUsd1d across BSC yield pools for this protocol
  website?: string;
  contractAddresses: string[];
  discoveredAt: number;
  source: 'defillama' | 'brave' | 'manual';
  verified: boolean;            // false = Brave-only find not confirmed on DeFiLlama
  lastResearched: number | null;
}

/** Top protocols in a category — returned by GET /api/research/category/:name */
export interface CategorySummary {
  category: ProtocolCategory;
  protocols: ProtocolEntry[];
  lastUpdated: number;
}

/** Return type from POST /api/research/discover */
export interface DiscoveryResult {
  newProtocols: ProtocolEntry[];
  totalScanned: number;
  lastRunAt: number;
}

/** Brave Search API result */
export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

// ---------------------------------------------------------------------------
// Risk Scoring
// ---------------------------------------------------------------------------

export interface TokenRiskScore {
  tokenAddress: string;
  score: number; // 0-100, higher = more risk
  isVerified: boolean;
  isHoneypot: boolean;
  isLiquidityLocked: boolean;
  hasAudit: boolean;
  mintable: boolean;
  liquidityUsd: number;
  holderCount: number;
  flags: string[];
}
