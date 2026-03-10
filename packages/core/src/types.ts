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

export type TraderArchetype = 'newcomer' | 'holder' | 'swapper' | 'farmer' | 'degen';
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
  | 'coingecko';

export interface ApiKeyRecord {
  service: ApiService;
  key: string; // AES-256 encrypted at rest
  addedAt: number;
  lastUsed: number;
  capabilities: string[];
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
