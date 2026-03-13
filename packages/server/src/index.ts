import 'dotenv/config';
// =============================================================================
// @binancebuddy/server — Dev Dashboard & API
// =============================================================================

import express, { type Express } from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { ethers } from 'ethers';
import {
  createProvider,
  checkProviderHealth,
  scanWallet,
  buildProfile,
  getBnbPriceUsd,
  getBnbBalance,
  rateLimiter,
  prepareSwap,
  executeSwap,
  getOrCreateAgentWallet,
} from '@binancebuddy/blockchain';
import { safeStringify, MULTICALL3_ADDRESS, NATIVE_BNB_ADDRESS, WBNB_ADDRESS, SAFE_TOKENS, GUARDRAIL_CONFIGS } from '@binancebuddy/core';
import type { BuddyState, AgentContext, SwapParams } from '@binancebuddy/core';
import {
  startResearchLoop,
  getLatestReport,
  runResearch,
  getTools,
  runAgent,
  resetCircuitBreaker,
  getCircuitBreakerStatus,
  ALL_TOOLS,
  researchCategory,
  researchProtocol,
  discoverNewProtocols,
  getRegistry,
  getRegistryEntry,
  getLastDiscoveryRun,
} from '@binancebuddy/ai';
import type { ProtocolCategory } from '@binancebuddy/core';
import {
  getWebhookHandler,
  startPolling,
  setWebhook,
} from '@binancebuddy/telegram';
import { awardXp, xpToStage } from '@binancebuddy/buddy';

const app: Express = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ?? 3000;
const MORALIS_API_KEY = process.env.MORALIS_API_KEY ?? '';
const ANKR_API_KEY = process.env.ANKR_API_KEY ?? '';
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY ?? '';

// Reusable provider
const provider = createProvider('mainnet', process.env.BSC_RPC_URL || undefined);

// ---------------------------------------------------------------------------
// Agent Wallet (initialized in app.listen callback)
// ---------------------------------------------------------------------------

let agentWallet: ethers.Wallet | null = null;

// ---------------------------------------------------------------------------
// Buddy State (persistent across requests)
// ---------------------------------------------------------------------------

const BUDDY_STATE_PATH = '.buddy-state.json';

const DEFAULT_BUDDY: BuddyState = {
  creatureType: 'creature_a',
  stage: 'seedling',
  xp: 0,
  level: 1,
  mood: 'neutral',
  moodReason: 'just started',
  trenchesUnlocked: false,
  achievements: [],
  lastInteraction: Date.now(),
  totalInteractions: 0,
  totalTradesExecuted: 0,
  streakDays: 0,
};

function loadBuddyState(): BuddyState {
  if (!existsSync(BUDDY_STATE_PATH)) return { ...DEFAULT_BUDDY };
  try {
    return JSON.parse(readFileSync(BUDDY_STATE_PATH, 'utf8')) as BuddyState;
  } catch {
    return { ...DEFAULT_BUDDY };
  }
}

function saveBuddyState(state: BuddyState): void {
  try {
    writeFileSync(BUDDY_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('[buddy] Failed to save state:', e);
  }
}

let buddyState: BuddyState = loadBuddyState();

// ---------------------------------------------------------------------------
// Token symbol → address resolver
// ---------------------------------------------------------------------------

function resolveToken(symbolOrAddress: string): string {
  if (symbolOrAddress.startsWith('0x')) return symbolOrAddress;
  const upper = symbolOrAddress.toUpperCase();
  if (upper === 'BNB') return NATIVE_BNB_ADDRESS;
  if (upper === 'WBNB') return WBNB_ADDRESS;
  const addr = SAFE_TOKENS[upper];
  if (addr) return addr;
  throw new Error(`Unknown token symbol: ${symbolOrAddress}. Use a contract address or known symbol (BNB, CAKE, USDT, USDC, BUSD, ETH, BTCB).`);
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/api/health', async (_req, res) => {
  const results: Record<string, { status: string; detail?: string }> = {};

  try {
    const block = await checkProviderHealth(provider);
    results.provider = { status: 'ok', detail: `Block #${block}` };
  } catch (e) {
    results.provider = { status: 'error', detail: String(e) };
  }

  try {
    const code = await provider.getCode(MULTICALL3_ADDRESS);
    const hasCode = code !== '0x';
    results.multicall3 = {
      status: hasCode ? 'ok' : 'warning',
      detail: hasCode ? 'Multicall3 contract reachable' : 'No bytecode — wrong network?',
    };
  } catch (e) {
    results.multicall3 = { status: 'error', detail: String(e) };
  }

  if (MORALIS_API_KEY) {
    try {
      const r = await fetch(
        'https://deep-index.moralis.io/api/v2.2/0x10ED43C718714eb63d5aA57B78B54704E256024E?chain=bsc&limit=1',
        { headers: { 'X-API-Key': MORALIS_API_KEY } },
      );
      results.moralis = r.ok
        ? { status: 'ok', detail: 'Tx history enabled via Moralis' }
        : { status: 'error', detail: `Moralis ${r.status}: ${r.statusText}` };
    } catch (e) {
      results.moralis = { status: 'error', detail: String(e) };
    }
  } else {
    results.moralis = { status: 'warning', detail: 'No MORALIS_API_KEY — tx history disabled' };
  }

  results.rateLimit = {
    status: rateLimiter.remaining > 5000 ? 'ok' : rateLimiter.remaining > 0 ? 'warning' : 'error',
    detail: `${rateLimiter.count.toLocaleString()} calls today, ${rateLimiter.remaining.toLocaleString()} remaining`,
  };

  try {
    const price = await getBnbPriceUsd(COINGECKO_API_KEY || undefined);
    results.coingecko = {
      status: price > 0 ? 'ok' : 'warning',
      detail: price > 0 ? `BNB = $${price.toFixed(2)}` : 'Rate limited or unavailable',
    };
  } catch (e) {
    results.coingecko = { status: 'error', detail: String(e) };
  }

  res.json(results);
});

// Wallet scan
app.post('/api/scan/:address', async (req, res) => {
  const { address } = req.params;
  try {
    const walletState = await scanWallet(provider, address, COINGECKO_API_KEY || undefined);
    const fullProfile = await buildProfile(
      address,
      walletState.tokens,
      MORALIS_API_KEY || undefined,
      ANKR_API_KEY || undefined,
    );
    res.type('application/json').send(safeStringify({ walletState, profile: fullProfile }));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---------------------------------------------------------------------------
// Agent Wallet Routes
// ---------------------------------------------------------------------------

app.get('/api/agent-wallet', async (_req, res) => {
  if (!agentWallet) {
    res.json({ configured: false, address: null, bnbBalance: null });
    return;
  }
  try {
    const balanceWei = await getBnbBalance(provider, agentWallet.address);
    const bnbBalanceFormatted = parseFloat(ethers.formatEther(balanceWei));
    res.json({
      configured: true,
      address: agentWallet.address,
      bnbBalance: balanceWei.toString(),
      bnbBalanceFormatted,
      network: 'BSC Mainnet',
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---------------------------------------------------------------------------
// Buddy State Routes
// ---------------------------------------------------------------------------

app.get('/api/buddy', (_req, res) => {
  res.json(buddyState);
});

app.post('/api/buddy', (req, res) => {
  const update = req.body as Partial<BuddyState>;
  buddyState = { ...buddyState, ...update, lastInteraction: Date.now() };
  saveBuddyState(buddyState);
  res.json(buddyState);
});

// ---------------------------------------------------------------------------
// Circuit Breaker Status
// ---------------------------------------------------------------------------

app.get('/api/circuit-breaker', (_req, res) => {
  res.json(getCircuitBreakerStatus());
});

// ---------------------------------------------------------------------------
// AI Agent Routes
// ---------------------------------------------------------------------------

app.get('/api/tools', (_req, res) => {
  const manifest = ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    requiresTrenchesMode: t.requiresTrenchesMode ?? false,
  }));
  res.json({ tools: manifest, count: manifest.length });
});

app.get('/api/research/latest', (_req, res) => {
  const report = getLatestReport();
  if (!report) {
    res.status(204).json({ message: 'No research report yet. Research runs every 30 minutes.' });
    return;
  }
  res.json(report);
});

app.post('/api/research/run', async (_req, res) => {
  try {
    const report = await runResearch();
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---------------------------------------------------------------------------
// Phase 2 Research Endpoints
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: ProtocolCategory[] = ['dex', 'lending', 'lp', 'yield', 'other'];

app.get('/api/research/categories', async (_req, res) => {
  try {
    const registry = getRegistry();
    const counts: Record<string, number> = {};
    for (const cat of VALID_CATEGORIES) counts[cat] = 0;
    for (const entry of registry) {
      if (entry.verified && entry.category in counts) counts[entry.category]++;
    }
    res.json({
      categories: VALID_CATEGORIES.map((name) => ({ name, count: counts[name] ?? 0 })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/research/category/:name', async (req, res) => {
  const cat = req.params.name as ProtocolCategory;
  if (!VALID_CATEGORIES.includes(cat)) {
    res.status(400).json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
    return;
  }
  try {
    const summary = await researchCategory(cat);
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/research/protocol/:slug', async (req, res) => {
  const { slug } = req.params;
  const walletAddress = req.query.wallet as string | undefined;

  // Block unverified protocols from auto-research
  const registryEntry = getRegistryEntry(slug);
  if (registryEntry && !registryEntry.verified) {
    res.status(400).json({
      error: `Protocol '${slug}' is unverified (found via Brave search but not confirmed on DeFiLlama). Deep dive is not available.`,
    });
    return;
  }

  try {
    let userProfile: import('@binancebuddy/core').UserProfile | undefined;
    if (walletAddress) {
      userProfile = await buildProfile(
        walletAddress,
        [],
        MORALIS_API_KEY || undefined,
        ANKR_API_KEY || undefined,
      );
    }

    const report = await researchProtocol(slug, userProfile);

    // Enrich category from registry if available
    if (registryEntry) {
      (report as { category: ProtocolCategory }).category = registryEntry.category;
    }

    res.json(report);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/research/discover', async (_req, res) => {
  try {
    const result = await discoverNewProtocols();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/research/discoveries', (_req, res) => {
  const all = getRegistry()
    .sort((a, b) => b.discoveredAt - a.discoveredAt)
    .slice(0, 20);
  res.json({ protocols: all, lastRunAt: getLastDiscoveryRun() });
});

app.post('/api/chat', async (req, res) => {
  const { message, walletAddress, mode, history } = req.body as {
    message?: string;
    walletAddress?: string;
    mode?: 'normal' | 'trenches';
    history?: unknown[];
  };

  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  if (message.toLowerCase().trim() === 'reset') {
    resetCircuitBreaker();
    res.json({ reply: 'Circuit breaker reset. Ready to go again!' });
    return;
  }

  try {
    const address = walletAddress ?? agentWallet?.address ?? '0x0000000000000000000000000000000000000000';
    const tradeMode = mode ?? 'normal';

    const walletStateData = walletAddress
      ? await scanWallet(provider, address, COINGECKO_API_KEY || undefined)
      : await (async () => {
          const bnbBalWei = agentWallet ? await getBnbBalance(provider, address) : 0n;
          const bnbBalFormatted = parseFloat(ethers.formatEther(bnbBalWei));
          return {
            address,
            chainId: 56,
            bnbBalance: bnbBalWei.toString(),
            bnbBalanceFormatted: bnbBalFormatted,
            tokens: [],
            totalValueUsd: 0,
            lastScanned: Date.now(),
          };
        })();

    const userProfile = walletAddress
      ? await buildProfile(address, walletStateData.tokens, MORALIS_API_KEY || undefined, ANKR_API_KEY || undefined)
      : {
          address,
          archetype: 'unknown' as const,
          riskScore: 5,
          protocols: [],
          preferredTokens: [],
          avgTradeSize: 0,
          tradingFrequency: 'rare' as const,
          totalTxCount: 0,
        };

    const context: AgentContext = {
      walletState: walletStateData,
      userProfile,
      buddyState,
      researchReport: getLatestReport(),
      recentTrades: [],
      mode: tradeMode,
      guardrailConfig: GUARDRAIL_CONFIGS[tradeMode],
    };

    const result = await runAgent(
      message,
      context,
      Array.isArray(history) ? (history as never[]) : [],
    );

    // Persist buddy XP awards
    if (result.xpAwarded > 0) {
      let updated = awardXp(buddyState, 'chat_interaction');
      updated = { ...updated, stage: xpToStage(updated.xp), trenchesUnlocked: updated.xp >= 500, lastInteraction: Date.now() };
      buddyState = updated;
      saveBuddyState(buddyState);
    }

    res.json({
      reply: result.reply,
      success: result.success,
      toolName: result.toolName,
      xpAwarded: result.xpAwarded,
      circuitBreakerTripped: result.circuitBreakerTripped,
      history: result.updatedHistory,
      buddyState,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---------------------------------------------------------------------------
// Swap Routes (direct execution via agent wallet)
// ---------------------------------------------------------------------------

app.post('/api/swap/quote', async (req, res) => {
  const { tokenIn = 'BNB', tokenOut, amountBnb, slippageBps = 100 } = req.body as {
    tokenIn?: string;
    tokenOut?: string;
    amountBnb?: number;
    slippageBps?: number;
  };

  if (!tokenOut || !amountBnb) {
    res.status(400).json({ error: 'tokenOut and amountBnb are required' });
    return;
  }

  try {
    const tokenInAddr = resolveToken(tokenIn);
    const tokenOutAddr = resolveToken(tokenOut);
    const amountInWei = BigInt(Math.floor(amountBnb * 1e18)).toString();
    const bnbPrice = await getBnbPriceUsd(COINGECKO_API_KEY || undefined);
    const walletAddress = agentWallet?.address ?? '0x0000000000000000000000000000000000000001';
    const bnbBal = agentWallet ? await getBnbBalance(provider, walletAddress) : 0n;
    const tradeMode = (slippageBps > 100 ? 'trenches' : 'normal') as 'normal' | 'trenches';

    const params: SwapParams = {
      tokenIn: tokenInAddr,
      tokenOut: tokenOutAddr,
      amountIn: amountInWei,
      slippageBps,
      recipient: walletAddress,
    };

    const result = await prepareSwap(provider, params, bnbBal, GUARDRAIL_CONFIGS[tradeMode], bnbPrice);
    res.type('application/json').send(safeStringify(result));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/swap/execute', async (req, res) => {
  if (!agentWallet) {
    res.status(503).json({ error: 'Agent wallet not configured. Server is still initializing or wallet generation failed.' });
    return;
  }

  const { tokenIn = 'BNB', tokenOut, amountBnb, slippageBps = 100, quote } = req.body as {
    tokenIn?: string;
    tokenOut?: string;
    amountBnb?: number;
    slippageBps?: number;
    quote?: unknown;
  };

  if (!tokenOut || !amountBnb) {
    res.status(400).json({ error: 'tokenOut and amountBnb are required' });
    return;
  }

  try {
    const tokenInAddr = resolveToken(tokenIn);
    const tokenOutAddr = resolveToken(tokenOut);
    const amountInWei = BigInt(Math.floor(amountBnb * 1e18)).toString();
    const bnbPrice = await getBnbPriceUsd(COINGECKO_API_KEY || undefined);
    const bnbBal = await getBnbBalance(provider, agentWallet.address);
    const tradeMode = (slippageBps > 100 ? 'trenches' : 'normal') as 'normal' | 'trenches';

    const params: SwapParams = {
      tokenIn: tokenInAddr,
      tokenOut: tokenOutAddr,
      amountIn: amountInWei,
      slippageBps,
      recipient: agentWallet.address,
    };

    // Use provided quote or re-fetch
    let swapQuote = quote as import('@binancebuddy/core').SwapQuote | undefined;
    if (!swapQuote) {
      const prepared = await prepareSwap(provider, params, bnbBal, GUARDRAIL_CONFIGS[tradeMode], bnbPrice);
      if ('error' in prepared) {
        res.status(400).json({ error: prepared.error });
        return;
      }
      if (!prepared.guardrail.passed) {
        res.status(400).json({ error: prepared.guardrail.failureReason ?? 'Guardrail check failed', guardrail: prepared.guardrail });
        return;
      }
      swapQuote = prepared.quote;
    }

    const signer = agentWallet.connect(provider);
    const swapResult = await executeSwap(provider, signer, params, swapQuote);

    // Award XP for successful trade
    if (swapResult.success) {
      let updated = awardXp(buddyState, 'trade_executed');
      updated = { ...updated, stage: xpToStage(updated.xp), trenchesUnlocked: updated.xp >= 500 };
      buddyState = updated;
      saveBuddyState(buddyState);
    }

    res.type('application/json').send(safeStringify({ ...swapResult, buddyState }));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---------------------------------------------------------------------------
// Telegram Routes
// ---------------------------------------------------------------------------

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const SERVER_URL = process.env.SERVER_URL ?? `http://localhost:${PORT}`;

app.post('/api/telegram/webhook', (req, res) => {
  if (!TELEGRAM_TOKEN) {
    res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN not configured' });
    return;
  }
  const handler = getWebhookHandler(TELEGRAM_TOKEN, SERVER_URL);
  handler(req, res);
});

app.post('/api/telegram/set-webhook', async (req, res) => {
  if (!TELEGRAM_TOKEN) {
    res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN not configured' });
    return;
  }
  const { webhookUrl } = req.body as { webhookUrl?: string };
  const url = webhookUrl ?? `${SERVER_URL}/api/telegram/webhook`;
  try {
    await setWebhook(TELEGRAM_TOKEN, url);
    res.json({ ok: true, webhookUrl: url });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/telegram/start-polling', async (_req, res) => {
  if (!TELEGRAM_TOKEN) {
    res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN not configured' });
    return;
  }
  try {
    startPolling(TELEGRAM_TOKEN, SERVER_URL).catch((err: unknown) =>
      console.error('[Telegram] Polling error:', err),
    );
    res.json({ ok: true, message: 'Polling started (check server logs)' });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/telegram/status', (_req, res) => {
  res.json({
    configured: Boolean(TELEGRAM_TOKEN),
    tokenPreview: TELEGRAM_TOKEN ? `...${TELEGRAM_TOKEN.slice(-4)}` : null,
  });
});

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

app.get('/api/tests', (_req, res) => {
  try {
    const output = execSync('pnpm exec vitest run --reporter=json 2>/dev/null || true', {
      cwd: process.cwd(),
      timeout: 60000,
      encoding: 'utf-8',
    });
    const jsonStart = output.indexOf('{');
    if (jsonStart === -1) {
      res.json({ raw: output });
      return;
    }
    const jsonStr = output.slice(jsonStart);
    try {
      res.json(JSON.parse(jsonStr));
    } catch {
      res.json({ raw: output });
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---------------------------------------------------------------------------
// Dashboard HTML
// ---------------------------------------------------------------------------

app.get('/', (_req, res) => {
  res.type('text/html').send(DASHBOARD_HTML);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, async () => {
  console.log(`\n  Binance Buddy Dev Dashboard`);
  console.log(`  http://localhost:${PORT}\n`);

  // Init agent wallet
  try {
    const info = getOrCreateAgentWallet(provider);
    agentWallet = info.wallet;
    if (!info.isNew) {
      console.log(`  Agent wallet: ${info.address}`);
    }
  } catch (e) {
    console.error('  [wallet] Failed to init agent wallet:', e);
  }

  startResearchLoop();

  if (MORALIS_API_KEY) console.log(`  ℹ  MORALIS_API_KEY set — tx history enabled`);
  else if (ANKR_API_KEY) console.log(`  ℹ  ANKR_API_KEY set — tx history via Ankr fallback`);
  else console.log(`  ℹ  No tx history key — wallet scan works via Multicall3 (token balances only)`);
});

export { app };

// ---------------------------------------------------------------------------
// Dashboard HTML
// ---------------------------------------------------------------------------

const DASHBOARD_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Binance Buddy — Dev Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --gold: #F0B90B; --gold-light: #FFD54F; --gold-dark: #C99700;
    --bg-primary: #0B0E11; --bg-secondary: #1E2329; --bg-tertiary: #2B3139;
    --bg-chat: #161A1E;
    --text-primary: #EAECEF; --text-secondary: #848E9C; --text-tertiary: #5E6673;
    --green: #0ECB81; --red: #F6465D; --blue: #1890FF; --orange: #FF8C00; --purple: #B659FF;
    --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px;
    --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
    --shadow-glow: 0 0 20px rgba(240,185,11,0.3);
  }
  body {
    background: var(--bg-primary); color: var(--text-primary);
    font-family: 'IBM Plex Sans', -apple-system, sans-serif; font-size: 15px; line-height: 1.5;
    padding: 0; max-width: 1400px; margin: 0 auto;
  }
  h2 { font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 600; margin-bottom: 12px; }
  /* Header */
  .page-header {
    background: var(--bg-secondary); border-bottom: 1px solid rgba(255,255,255,0.06);
    padding: 14px 24px; display: flex; align-items: center; gap: 24px; flex-wrap: wrap;
  }
  .page-header h1 { font-family: 'Space Grotesk', sans-serif; font-size: 20px; font-weight: 700; color: var(--gold); white-space: nowrap; }
  .header-meta { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; flex: 1; }
  .agent-wallet-display { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 8px; }
  .agent-wallet-display .addr { color: var(--text-primary); }
  .agent-wallet-display .bal { color: var(--gold); font-weight: 600; }
  .indicator { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: 9999px; }
  .indicator.ok { background: rgba(14,203,129,0.12); color: var(--green); }
  .indicator.warn { background: rgba(255,140,0,0.12); color: var(--orange); }
  .indicator.err { background: rgba(246,70,93,0.12); color: var(--red); }
  .indicator.off { background: rgba(255,255,255,0.06); color: var(--text-tertiary); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  /* Controls bar */
  .controls-bar {
    padding: 10px 24px; background: var(--bg-secondary); border-bottom: 1px solid rgba(255,255,255,0.04);
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
  }
  .controls-bar .wallet-input-wrap { display: flex; gap: 8px; flex: 1; min-width: 260px; }
  .mode-toggle { display: flex; border-radius: var(--radius-sm); overflow: hidden; border: 1px solid rgba(255,255,255,0.1); }
  .mode-btn { background: var(--bg-tertiary); color: var(--text-secondary); border: none; padding: 6px 16px; cursor: pointer; font-size: 13px; font-weight: 500; font-family: inherit; transition: all 150ms; }
  .mode-btn.active.normal { background: rgba(14,203,129,0.2); color: var(--green); }
  .mode-btn.active.trenches { background: rgba(255,140,0,0.2); color: var(--orange); }
  /* Main content */
  .main { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card {
    background: var(--bg-secondary); border-radius: var(--radius-md); padding: 16px;
    border: 1px solid rgba(255,255,255,0.06); box-shadow: var(--shadow-md);
  }
  .card.trenches-active { border-color: rgba(255,140,0,0.35); }
  /* Inputs / Buttons */
  input[type="text"], input[type="number"] {
    background: var(--bg-tertiary); border: 1px solid transparent; border-radius: var(--radius-sm);
    padding: 8px 12px; color: var(--text-primary); font-family: 'JetBrains Mono', monospace;
    font-size: 13px; width: 100%; outline: none; transition: border 150ms ease, box-shadow 150ms ease;
  }
  input:focus { border-color: var(--gold); box-shadow: var(--shadow-glow); }
  input::placeholder { color: var(--text-tertiary); }
  .btn {
    background: var(--gold); color: var(--bg-primary); border: none; border-radius: var(--radius-sm);
    padding: 0 14px; height: 36px; font-weight: 600; font-size: 13px; cursor: pointer;
    transition: background 150ms ease; font-family: inherit; white-space: nowrap;
  }
  .btn:hover { background: var(--gold-light); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-sm { height: 30px; padding: 0 10px; font-size: 12px; }
  .btn-sec { background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid rgba(255,255,255,0.1); }
  .btn-sec:hover { background: #363d47; }
  .btn-danger { background: var(--red); color: white; }
  .btn-danger:hover { background: #d63447; }
  .input-row { display: flex; gap: 8px; margin-bottom: 10px; }
  .input-row input { flex: 1; }
  /* Chat */
  .chat-messages {
    background: var(--bg-chat); border-radius: var(--radius-sm); height: 320px;
    overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
    margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.04);
  }
  .msg { max-width: 82%; display: flex; flex-direction: column; gap: 2px; }
  .msg-user { align-self: flex-end; align-items: flex-end; }
  .msg-buddy { align-self: flex-start; align-items: flex-start; }
  .msg-system { align-self: center; align-items: center; max-width: 100%; }
  .msg-bubble {
    padding: 8px 12px; border-radius: var(--radius-md); font-size: 13px; line-height: 1.5;
    word-break: break-word; white-space: pre-wrap;
  }
  .msg-user .msg-bubble { background: var(--bg-tertiary); }
  .msg-buddy .msg-bubble { background: var(--bg-secondary); border: 1px solid rgba(255,255,255,0.06); }
  .msg-system .msg-bubble { background: transparent; color: var(--text-secondary); font-size: 12px; font-style: italic; text-align: center; }
  .msg-system.tool .msg-bubble { color: var(--gold); }
  .msg-system.xp .msg-bubble { color: var(--purple); }
  .msg-system.error .msg-bubble { color: var(--red); }
  .msg-prefix { font-size: 11px; color: var(--text-tertiary); margin-bottom: 2px; }
  .typing-indicator { color: var(--text-tertiary); font-size: 13px; font-style: italic; padding: 4px 0; }
  .typing-dot { animation: blink 1.4s infinite; }
  .typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .typing-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }
  .cb-banner { background: rgba(246,70,93,0.15); border: 1px solid var(--red); border-radius: var(--radius-sm); padding: 8px 12px; font-size: 13px; color: var(--red); margin-bottom: 10px; display: none; }
  /* Buddy */
  .buddy-avatar {
    width: 80px; height: 80px; border-radius: var(--radius-md); margin: 0 auto 12px;
    display: flex; align-items: center; justify-content: center; font-size: 28px;
    box-shadow: var(--shadow-glow);
  }
  .xp-bar-wrap { height: 6px; background: var(--bg-tertiary); border-radius: 9999px; overflow: hidden; margin: 6px 0; }
  .xp-bar-fill { height: 100%; background: var(--purple); border-radius: 9999px; transition: width 600ms ease; }
  .buddy-stat-row { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .buddy-stat-row:last-child { border-bottom: none; }
  /* Research */
  .market-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
  .bnb-price { font-size: 22px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; color: var(--gold); }
  .sentiment-badge { padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
  .sentiment-bullish { background: rgba(14,203,129,0.15); color: var(--green); }
  .sentiment-neutral { background: rgba(255,255,255,0.08); color: var(--text-secondary); }
  .sentiment-bearish { background: rgba(246,70,93,0.15); color: var(--red); }
  .farm-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  .farm-table th { text-align: left; color: var(--text-secondary); font-weight: 500; padding: 4px 6px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .farm-table td { padding: 5px 6px; border-bottom: 1px solid rgba(255,255,255,0.03); }
  .risk-low { color: var(--green); } .risk-med { color: var(--orange); } .risk-high { color: var(--red); }
  .apy-high { color: var(--gold); font-weight: 600; } .apy-mid { color: var(--green); }
  /* Trade */
  .trade-inputs { display: grid; grid-template-columns: 1fr 80px 1fr; gap: 8px; align-items: end; margin-bottom: 12px; }
  .trade-arrow { text-align: center; color: var(--text-tertiary); font-size: 18px; padding-bottom: 4px; }
  .quote-card { background: var(--bg-tertiary); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 10px; display: none; }
  .quote-row { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; }
  .quote-amount { font-size: 18px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; }
  .guardrail-row { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0; }
  .guardrail-pass { color: var(--green); } .guardrail-fail { color: var(--red); }
  .trade-actions { display: flex; gap: 8px; }
  .tx-result { background: var(--bg-tertiary); border-radius: var(--radius-sm); padding: 12px; display: none; margin-top: 10px; }
  /* Trenches */
  .sniper-status { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 10px; }
  .sniper-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-tertiary); }
  .sniper-dot.active { background: var(--orange); box-shadow: 0 0 8px var(--orange); animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  /* Activity log */
  .log-box {
    background: var(--bg-chat); border-radius: var(--radius-sm); height: 180px;
    overflow-y: auto; padding: 8px 10px; font-family: 'JetBrains Mono', monospace;
    font-size: 11px; line-height: 1.6; border: 1px solid rgba(255,255,255,0.04);
    margin-top: 8px;
  }
  .log-entry { padding: 1px 0; }
  .log-time { color: var(--text-tertiary); margin-right: 6px; }
  .log-type { font-weight: 600; margin-right: 6px; padding: 0 4px; border-radius: 3px; }
  .lt-info { color: var(--text-secondary); background: rgba(255,255,255,0.05); }
  .lt-tool { color: var(--gold); background: rgba(240,185,11,0.1); }
  .lt-agent { color: var(--blue); background: rgba(24,144,255,0.1); }
  .lt-xp { color: var(--purple); background: rgba(182,89,255,0.1); }
  .lt-error { color: var(--red); background: rgba(246,70,93,0.1); }
  .lt-research { color: var(--blue); background: rgba(24,144,255,0.08); }
  .lt-health { color: var(--green); background: rgba(14,203,129,0.08); }
  .lt-trenches { color: var(--orange); background: rgba(255,140,0,0.1); }
  .lt-trade { color: var(--green); background: rgba(14,203,129,0.1); }
  /* Status/badge */
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
  .badge-gold { background: rgba(240,185,11,0.15); color: var(--gold); }
  .badge-green { background: rgba(14,203,129,0.15); color: var(--green); }
  .badge-red { background: rgba(246,70,93,0.15); color: var(--red); }
  .badge-blue { background: rgba(24,144,255,0.15); color: var(--blue); }
  .badge-purple { background: rgba(182,89,255,0.15); color: var(--purple); }
  .badge-orange { background: rgba(255,140,0,0.15); color: var(--orange); }
  /* Misc */
  .section-label { color: var(--gold); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin: 10px 0 6px; }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
  .status-dot.ok { background: var(--green); } .status-dot.warning { background: var(--orange); } .status-dot.error { background: var(--red); } .status-dot.pending { background: var(--text-tertiary); }
  .status-row { display: flex; align-items: center; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; }
  .status-row:last-child { border-bottom: none; }
  .status-label { width: 100px; font-weight: 500; }
  .status-detail { color: var(--text-secondary); font-size: 12px; }
  .mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
  .text-sec { color: var(--text-secondary); }
  .text-sm { font-size: 12px; }
  .spinner { display: inline-block; width: 13px; height: 13px; border: 2px solid var(--text-tertiary); border-top-color: var(--gold); border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; margin-right: 4px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .token-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  .token-table th { text-align: left; color: var(--text-secondary); padding: 4px 6px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .token-table td { padding: 5px 6px; border-bottom: 1px solid rgba(255,255,255,0.03); }
  details summary { cursor: pointer; color: var(--text-secondary); font-size: 13px; padding: 8px 0; user-select: none; }
  details summary:hover { color: var(--text-primary); }
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
  /* Research v2 */
  .research-tabs { display:flex; gap:4px; margin-bottom:12px; flex-wrap:wrap; }
  .rtab { padding:5px 12px; border-radius:6px; border:1px solid var(--bg-tertiary); background:var(--bg-tertiary); color:var(--text-sec); font-size:12px; cursor:pointer; transition:all 0.15s; }
  .rtab:hover { border-color:var(--gold); color:var(--gold); }
  .rtab.active { background:rgba(240,185,11,0.12); border-color:var(--gold); color:var(--gold); }
  .proto-row { display:flex; align-items:center; padding:8px 10px; border-radius:6px; background:var(--bg-tertiary); margin-bottom:6px; gap:10px; }
  .proto-name { font-weight:600; font-size:13px; flex:1; }
  .proto-meta { font-size:11px; color:var(--text-sec); flex:2; display:flex; gap:16px; }
  .proto-meta span { display:flex; flex-direction:column; }
  .proto-meta .label { font-size:10px; color:var(--text-sec); opacity:.7; }
  .proto-meta .value { font-size:12px; color:var(--text-primary); }
  .pool-row { display:flex; align-items:center; padding:8px 10px; border-radius:6px; margin-bottom:4px; gap:10px; }
  .pool-row.highlighted { background:rgba(240,185,11,0.08); border:1px solid rgba(240,185,11,0.2); }
  .pool-row.other { background:var(--bg-tertiary); opacity:.8; }
  .pool-symbol { font-weight:600; font-size:13px; flex:1; }
  .pool-apy { font-size:14px; font-weight:700; color:var(--green); min-width:70px; }
  .pool-tvl { font-size:12px; color:var(--text-sec); min-width:80px; }
  .pool-il { font-size:11px; padding:2px 6px; border-radius:4px; }
  .pool-il.low,.pool-il.none { background:rgba(14,203,129,0.1); color:var(--green); }
  .pool-il.medium { background:rgba(255,140,0,0.1); color:var(--orange); }
  .pool-il.high { background:rgba(246,70,93,0.1); color:var(--red); }
  .section-header { font-size:10px; font-weight:700; letter-spacing:.08em; color:var(--text-sec); text-transform:uppercase; margin:10px 0 6px; }
  .strategy-brief { background:rgba(24,144,255,0.06); border:1px solid rgba(24,144,255,0.15); border-radius:8px; padding:10px 12px; font-size:13px; line-height:1.55; margin-bottom:12px; }
  .risk-badges { display:flex; gap:8px; flex-wrap:wrap; }
  .risk-badge { padding:3px 8px; border-radius:4px; font-size:11px; }
  .rb-green { background:rgba(14,203,129,0.1); color:var(--green); }
  .rb-red { background:rgba(246,70,93,0.1); color:var(--red); }
  .rb-yellow { background:rgba(240,185,11,0.1); color:var(--gold); }
  .rb-blue { background:rgba(24,144,255,0.1); color:var(--blue); }
  .charts-row { display:flex; gap:12px; margin-bottom:12px; flex-wrap:wrap; }
  .chart-wrap { flex:1; min-width:180px; max-width:33%; background:var(--bg-tertiary); border-radius:8px; padding:10px; }
  .chart-title { font-size:11px; color:var(--text-sec); margin-bottom:6px; text-align:center; }
  .discovery-row { display:flex; align-items:center; padding:8px 10px; border-radius:6px; background:var(--bg-tertiary); margin-bottom:6px; gap:10px; }
  .disc-name { font-weight:600; font-size:13px; flex:1; }
  .disc-meta { font-size:11px; color:var(--text-sec); }
  .badge-unverified { background:rgba(255,140,0,0.1); color:var(--orange); padding:2px 6px; border-radius:4px; font-size:10px; }
  .back-btn { display:inline-flex; align-items:center; gap:4px; color:var(--text-sec); font-size:12px; cursor:pointer; margin-bottom:10px; }
  .back-btn:hover { color:var(--text-primary); }
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
</head>
<body>

<!-- Header -->
<div class="page-header">
  <h1>🐾 Binance Buddy</h1>
  <div class="header-meta">
    <div class="agent-wallet-display">
      <span class="text-sec">Agent Wallet:</span>
      <span id="aw-addr" class="addr mono">loading...</span>
      <span id="aw-bal" class="bal"></span>
    </div>
    <div id="cb-indicator" class="indicator off"><span class="dot"></span> Circuit Breaker</div>
    <div id="tg-indicator" class="indicator off"><span class="dot"></span> Telegram</div>
  </div>
</div>

<!-- Controls bar -->
<div class="controls-bar">
  <div class="wallet-input-wrap">
    <input type="text" id="global-wallet" placeholder="External wallet to scan (0x...)" style="flex:1" />
    <button class="btn btn-sec btn-sm" onclick="setGlobalWallet()">Set</button>
    <button class="btn btn-sec btn-sm" onclick="useAgentWallet()">Use Agent</button>
  </div>
  <div id="active-wallet-display" class="text-sec text-sm mono" style="white-space:nowrap"></div>
  <div class="mode-toggle">
    <button id="btn-normal" class="mode-btn normal active" onclick="setMode('normal')">● Normal</button>
    <button id="btn-trenches" class="mode-btn trenches" onclick="setMode('trenches')">⚡ Trenches</button>
  </div>
</div>

<!-- Main content -->
<div class="main">

  <!-- Row 1: Health | Buddy -->
  <div class="grid-2">

    <!-- Health -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h2 style="margin:0">System Health</h2>
        <button class="btn btn-sec btn-sm" onclick="runHealth()">Check</button>
      </div>
      <div id="health-list">
        <div class="status-row"><span class="status-dot pending"></span><span class="status-label">Provider</span><span class="status-detail">—</span></div>
        <div class="status-row"><span class="status-dot pending"></span><span class="status-label">Multicall3</span><span class="status-detail">—</span></div>
        <div class="status-row"><span class="status-dot pending"></span><span class="status-label">Moralis</span><span class="status-detail">—</span></div>
        <div class="status-row"><span class="status-dot pending"></span><span class="status-label">RateLimit</span><span class="status-detail">—</span></div>
        <div class="status-row"><span class="status-dot pending"></span><span class="status-label">CoinGecko</span><span class="status-detail">—</span></div>
      </div>
    </div>

    <!-- Buddy -->
    <div class="card" id="buddy-card">
      <h2>Your Buddy</h2>
      <div id="buddy-avatar" class="buddy-avatar" style="background: linear-gradient(135deg, #0ECB81, #0a9960)">🌱</div>
      <div style="text-align:center;margin-bottom:8px">
        <span id="buddy-stage-label" style="font-weight:600;font-family:'Space Grotesk',sans-serif">Seedling</span>
        <span class="text-sec text-sm"> · Lv.<span id="buddy-level">1</span></span>
      </div>
      <div class="xp-bar-wrap"><div class="xp-bar-fill" id="buddy-xp-fill" style="width:0%"></div></div>
      <div class="text-sec text-sm" style="text-align:center;margin-bottom:8px" id="buddy-xp-label">0 / 100 XP</div>
      <div class="buddy-stat-row"><span class="text-sec">Mood</span><span id="buddy-mood">😐 Neutral</span></div>
      <div class="buddy-stat-row"><span class="text-sec">Trades</span><span id="buddy-trades">0</span></div>
      <div class="buddy-stat-row"><span class="text-sec">Trenches</span><span id="buddy-trenches" class="badge badge-red">🔒 Locked</span></div>
    </div>
  </div>

  <!-- Row 2: Chat | Trade -->
  <div class="grid-2">

    <!-- Chat -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h2 style="margin:0">Agent Chat</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <span id="chat-mode-badge" class="badge badge-green">Normal Mode</span>
          <button class="btn btn-sec btn-sm" onclick="resetCB()">Reset CB</button>
        </div>
      </div>
      <div id="cb-banner" class="cb-banner">⛔ Circuit breaker tripped — 3 consecutive failures. <button class="btn btn-sm btn-danger" onclick="resetCB()">Reset</button></div>
      <div class="chat-messages" id="chat-messages">
        <div class="msg msg-system"><div class="msg-bubble">Chat started. Say hi to your Buddy or try: "what tokens do I hold?" or "find farms"</div></div>
      </div>
      <div id="typing-indicator" style="display:none" class="typing-indicator">
        Buddy is thinking<span class="typing-dot">.</span><span class="typing-dot">.</span><span class="typing-dot">.</span>
      </div>
      <div class="input-row" style="margin:0">
        <input type="text" id="chat-input" placeholder="Talk to your Buddy..." onkeydown="if(event.key==='Enter')chatSend()" />
        <button class="btn" id="chat-send-btn" onclick="chatSend()">Send →</button>
      </div>
    </div>

    <!-- Trade -->
    <div class="card">
      <h2>Trade (Agent Wallet)</h2>
      <div class="trade-inputs">
        <div>
          <div class="text-sec text-sm" style="margin-bottom:4px">From</div>
          <input type="text" id="trade-from" value="BNB" placeholder="BNB or 0x..." />
        </div>
        <div class="trade-arrow">→</div>
        <div>
          <div class="text-sec text-sm" style="margin-bottom:4px">To</div>
          <input type="text" id="trade-to" placeholder="CAKE" />
        </div>
      </div>
      <div class="input-row">
        <input type="number" id="trade-amount" placeholder="Amount (BNB)" step="0.001" min="0" style="flex:1" />
        <button class="btn btn-sec" onclick="tradeGetQuote()">Quote →</button>
      </div>
      <div id="trade-error" class="text-sm" style="color:var(--red);margin-bottom:8px;display:none"></div>
      <div class="quote-card" id="quote-card">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px">
          <span class="quote-amount" id="q-amount-in">—</span>
          <span class="text-sec">→</span>
          <span class="quote-amount" id="q-amount-out" style="color:var(--green)">—</span>
        </div>
        <div class="quote-row"><span class="text-sec">Price impact</span><span id="q-impact">—</span></div>
        <div class="quote-row"><span class="text-sec">Gas</span><span id="q-gas">—</span></div>
        <div class="quote-row"><span class="text-sec">Slippage</span><span id="q-slippage">—</span></div>
        <div class="quote-row"><span class="text-sec">Route</span><span id="q-route" class="mono text-sm">—</span></div>
        <div class="section-label">Guardrails</div>
        <div id="q-guardrails"></div>
      </div>
      <div class="trade-actions" id="trade-actions" style="display:none">
        <button class="btn btn-sec" style="flex:1" onclick="tradeCancel()">Cancel</button>
        <button class="btn" style="flex:2" onclick="tradeExecute()">Confirm Swap ✓</button>
      </div>
      <div class="tx-result" id="tx-result"></div>
    </div>
  </div>

  <!-- Row 3: Research (Phase 2) -->
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h2 style="margin:0">Research</h2>
      <div style="display:flex;align-items:center;gap:8px">
        <span id="research-age" class="text-sec text-sm"></span>
        <button class="btn btn-sec btn-sm" id="research-run-btn" onclick="runResearchCycle()">Background ↺</button>
      </div>
    </div>

    <!-- Category tabs -->
    <div class="research-tabs">
      <button class="rtab" onclick="selectResearchTab('dex')">DEX</button>
      <button class="rtab" onclick="selectResearchTab('lending')">Lending</button>
      <button class="rtab" onclick="selectResearchTab('lp')">LP</button>
      <button class="rtab" onclick="selectResearchTab('yield')">Yield Farming</button>
      <button class="rtab" onclick="selectResearchTab('discover')">Discover 🔍</button>
    </div>

    <!-- Category view -->
    <div id="research-view-category" style="display:none">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div class="section-header" id="category-view-title">TOP PROTOCOLS</div>
        <button class="btn btn-sec btn-sm" onclick="refreshCategory()">Refresh ↺</button>
      </div>
      <div id="category-list"><div class="text-sec text-sm">Select a category above.</div></div>
    </div>

    <!-- Deep dive view -->
    <div id="research-view-deepdive" style="display:none">
      <div class="back-btn" onclick="backToCategory()">← Back</div>
      <div id="deepdive-title" style="font-size:16px;font-weight:700;margin-bottom:12px"></div>

      <div class="section-header">Best Opportunities</div>
      <div id="deepdive-best"></div>

      <div class="section-header" id="other-pools-header" style="display:none">Other Pools</div>
      <div id="deepdive-other"></div>

      <div class="section-header">Strategy Brief</div>
      <div id="deepdive-brief" class="strategy-brief text-sec text-sm">Loading...</div>

      <div class="section-header">Charts</div>
      <div id="deepdive-charts" class="charts-row"></div>

      <div class="section-header">Risk Assessment</div>
      <div id="deepdive-risk" class="risk-badges"></div>
    </div>

    <!-- Discovery view -->
    <div id="research-view-discover" style="display:none">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div class="section-header">DISCOVERY FEED</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span id="disc-last" class="text-sec text-sm"></span>
          <button class="btn btn-sec btn-sm" id="disc-scan-btn" onclick="runDiscovery()">Scan Now</button>
        </div>
      </div>
      <div id="discovery-list"><div class="text-sec text-sm">Click Scan Now to discover new protocols.</div></div>
    </div>

    <!-- Legacy summary (shown when no tab selected) -->
    <div id="research-summary">
      <div class="text-sec text-sm">Select a category tab above, or click Background ↺ to refresh the market report.</div>
    </div>
  </div>

  <!-- Row 4: Trenches | Wallet Scanner -->
  <div class="grid-2">

    <!-- Trenches -->
    <div class="card" id="trenches-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h2 style="margin:0">Trenches</h2>
        <span id="trenches-lock-badge" class="badge badge-red">🔒 Locked (need 500 XP)</span>
      </div>
      <div class="section-label">Sniper</div>
      <div class="sniper-status">
        <div class="sniper-dot" id="sniper-dot"></div>
        <span id="sniper-status-label">Inactive</span>
        <button class="btn btn-sec btn-sm" id="sniper-btn" onclick="activateSniper()" disabled>Activate</button>
      </div>
      <div id="sniper-pairs">
        <div class="text-sec text-sm">No pairs detected yet.</div>
      </div>
      <div class="section-label" style="margin-top:12px">Farm Scanner</div>
      <button class="btn btn-sec btn-sm" onclick="scanFarms()" id="farms-btn">Scan Farms</button>
      <div id="farms-results" style="margin-top:8px">
        <div class="text-sec text-sm">Click Scan Farms to load opportunities.</div>
      </div>
    </div>

    <!-- Wallet Scanner -->
    <div class="card">
      <h2>Wallet Scanner</h2>
      <div class="input-row">
        <input type="text" id="scan-input" placeholder="BSC address (0x...)" />
        <button class="btn" onclick="scanWallet()" id="scan-btn">Scan</button>
      </div>
      <div id="scan-result"></div>
    </div>
  </div>

  <!-- Activity Log -->
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <h2 style="margin:0">Activity Log</h2>
      <button class="btn btn-sec btn-sm" onclick="clearLog()">Clear</button>
    </div>
    <div class="log-box" id="log-box"></div>
  </div>

  <!-- Test Runner (collapsed) -->
  <details>
    <summary>▶ Test Runner</summary>
    <div class="card" style="margin-top:8px">
      <div style="margin-bottom:10px"><button class="btn btn-sec" onclick="runTests()" id="test-btn">Run All Tests</button></div>
      <div id="test-results"><div class="text-sec text-sm">Click to run tests</div></div>
    </div>
  </details>

</div>

<script>
// =============================================================================
// Global state
// =============================================================================
var _wallet = '';
var _mode = 'normal';
var _chatHistory = [];
var _buddyXp = 0;
var _pendingQuote = null;
var _sniperActive = false;
var _agentWalletAddr = null;

// =============================================================================
// Activity Log
// =============================================================================
var _logEntries = [];

function log(type, msg) {
  var now = new Date();
  var ts = now.getHours().toString().padStart(2,'0') + ':' +
           now.getMinutes().toString().padStart(2,'0') + ':' +
           now.getSeconds().toString().padStart(2,'0');
  _logEntries.push({ ts: ts, type: type, msg: String(msg).slice(0, 160) });
  if (_logEntries.length > 200) _logEntries.shift();
  renderLog();
}

function renderLog() {
  var box = document.getElementById('log-box');
  if (!box) return;
  var html = '';
  for (var i = 0; i < _logEntries.length; i++) {
    var e = _logEntries[i];
    var cls = 'lt-' + e.type.toLowerCase();
    html += '<div class="log-entry"><span class="log-time">' + e.ts + '</span>' +
            '<span class="log-type ' + cls + '">' + e.type + '</span>' +
            '<span>' + escapeHtml(e.msg) + '</span></div>';
  }
  box.innerHTML = html || '<span class="text-sec text-sm">No activity yet.</span>';
  box.scrollTop = box.scrollHeight;
}

function clearLog() {
  _logEntries = [];
  renderLog();
}

// =============================================================================
// Utilities
// =============================================================================
function escapeHtml(s) {
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function formatNum(n) {
  if (n == null) return '0';
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  if (n > 0) return n.toExponential(2);
  return '0';
}

function formatUsd(n) {
  if (n == null) return '$0.00';
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function relativeTime(ts) {
  if (!ts) return 'never';
  var diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

// =============================================================================
// Header: Agent Wallet + Circuit Breaker + Telegram
// =============================================================================
function loadHeader() {
  // Agent wallet
  fetch('/api/agent-wallet')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var addrEl = document.getElementById('aw-addr');
      var balEl = document.getElementById('aw-bal');
      if (d.configured && d.address) {
        _agentWalletAddr = d.address;
        addrEl.textContent = d.address.slice(0,6) + '...' + d.address.slice(-4);
        addrEl.title = d.address;
        balEl.textContent = d.bnbBalanceFormatted != null ? d.bnbBalanceFormatted.toFixed(4) + ' BNB' : '';
        log('INFO', 'Agent wallet: ' + d.address.slice(0,6) + '... (' + (d.bnbBalanceFormatted || 0).toFixed(4) + ' BNB)');
      } else {
        addrEl.textContent = 'not configured';
      }
    })
    .catch(function() { document.getElementById('aw-addr').textContent = 'error'; });

  // Circuit breaker
  loadCbStatus();

  // Telegram
  fetch('/api/telegram/status')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var el = document.getElementById('tg-indicator');
      if (d.configured) {
        el.className = 'indicator ok';
        el.innerHTML = '<span class="dot"></span> Telegram ' + (d.tokenPreview || '');
      } else {
        el.className = 'indicator off';
        el.innerHTML = '<span class="dot"></span> Telegram (not configured)';
      }
    })
    .catch(function() {});
}

function loadCbStatus() {
  fetch('/api/circuit-breaker')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var el = document.getElementById('cb-indicator');
      var banner = document.getElementById('cb-banner');
      if (d.tripped) {
        el.className = 'indicator err';
        el.innerHTML = '<span class="dot"></span> CB Tripped (' + d.failures + '/' + d.threshold + ')';
        if (banner) banner.style.display = 'block';
      } else if (d.failures > 0) {
        el.className = 'indicator warn';
        el.innerHTML = '<span class="dot"></span> CB ' + d.failures + '/' + d.threshold;
        if (banner) banner.style.display = 'none';
      } else {
        el.className = 'indicator ok';
        el.innerHTML = '<span class="dot"></span> Circuit OK';
        if (banner) banner.style.display = 'none';
      }
    })
    .catch(function() {});
}

// =============================================================================
// Global Wallet + Mode
// =============================================================================
function setGlobalWallet() {
  var val = document.getElementById('global-wallet').value.trim();
  if (val) {
    _wallet = val;
    document.getElementById('active-wallet-display').textContent = 'Active: ' + val.slice(0,6) + '...' + val.slice(-4);
    log('INFO', 'Active wallet set: ' + val.slice(0,6) + '...' + val.slice(-4));
  }
}

function useAgentWallet() {
  if (_agentWalletAddr) {
    _wallet = _agentWalletAddr;
    document.getElementById('global-wallet').value = _agentWalletAddr;
    document.getElementById('active-wallet-display').textContent = 'Active: Agent (' + _agentWalletAddr.slice(0,6) + '...)';
    log('INFO', 'Using agent wallet: ' + _agentWalletAddr.slice(0,6) + '...');
  }
}

function setMode(m) {
  _mode = m;
  document.getElementById('btn-normal').className = 'mode-btn normal' + (m === 'normal' ? ' active' : '');
  document.getElementById('btn-trenches').className = 'mode-btn trenches' + (m === 'trenches' ? ' active' : '');
  document.getElementById('chat-mode-badge').textContent = m === 'trenches' ? 'Trenches Mode' : 'Normal Mode';
  document.getElementById('chat-mode-badge').className = m === 'trenches' ? 'badge badge-orange' : 'badge badge-green';
  var tc = document.getElementById('trenches-card');
  if (tc) tc.className = 'card' + (m === 'trenches' ? ' trenches-active' : '');
  log(m === 'trenches' ? 'TRENCHES' : 'INFO', 'Mode set to ' + m);
}

// =============================================================================
// Health Check
// =============================================================================
function runHealth() {
  var list = document.getElementById('health-list');
  list.innerHTML = '<div class="text-sec text-sm"><span class="spinner"></span>Checking...</div>';
  log('HEALTH', 'Running health check...');
  fetch('/api/health')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var html = '';
      for (var k in d) {
        var info = d[k];
        html += '<div class="status-row"><span class="status-dot ' + info.status + '"></span>' +
                '<span class="status-label">' + k.charAt(0).toUpperCase() + k.slice(1) + '</span>' +
                '<span class="status-detail">' + escapeHtml(info.detail || '') + '</span></div>';
        log('HEALTH', k + ': ' + info.status + (info.detail ? ' — ' + info.detail : ''));
      }
      list.innerHTML = html;
    })
    .catch(function(e) {
      list.innerHTML = '<div style="color:var(--red)">' + escapeHtml(e.message) + '</div>';
      log('ERROR', 'Health check failed: ' + e.message);
    });
}

// =============================================================================
// Research v2
// =============================================================================
var _latestReport = null;
var _activeCategory = null;
var _charts = {};

// ---------------------------------------------------------------------------
// renderChart — reusable client-side chart renderer (Fix #6)
// Takes ChartConfig JSON from API and renders via Chart.js
// ---------------------------------------------------------------------------
function renderChart(canvasId, chartConfig) {
  var canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return;
  if (_charts[canvasId]) { _charts[canvasId].destroy(); delete _charts[canvasId]; }
  var ctx = canvas.getContext('2d');
  _charts[canvasId] = new Chart(ctx, {
    type: chartConfig.type,
    data: {
      labels: chartConfig.labels,
      datasets: chartConfig.datasets.map(function(ds) {
        return {
          label: ds.label,
          data: ds.data,
          borderColor: ds.color,
          backgroundColor: ds.color + '33',
          tension: 0.3,
          fill: chartConfig.type === 'line',
          pointRadius: 2
        };
      })
    },
    options: {
      responsive: true,
      plugins: { legend: { display: chartConfig.datasets.length > 1, labels: { color: '#848E9C', font: { size: 10 } } } },
      scales: {
        x: { ticks: { maxTicksLimit: 6, color: '#848E9C', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#848E9C', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Background market report (30min loop, legacy)
// ---------------------------------------------------------------------------
function loadResearchSummary() {
  fetch('/api/research/latest')
    .then(function(r) { return r.status === 204 ? null : r.json(); })
    .then(function(d) {
      _latestReport = d;
      if (d) {
        var mo = d.marketOverview;
        var el = document.getElementById('research-summary');
        if (el && !_activeCategory) {
          var change = mo.bnbChange24h || 0;
          var changeColor = change >= 0 ? 'var(--green)' : 'var(--red)';
          el.innerHTML = '<div class="market-row">' +
            '<span class="bnb-price">$' + (mo.bnbPriceUsd || 0).toFixed(2) + '</span>' +
            '<span style="color:' + changeColor + ';font-size:12px">' + (change >= 0 ? '+' : '') + change.toFixed(1) + '%</span>' +
            '<span class="sentiment-badge sentiment-' + (mo.marketSentiment || 'neutral') + '">' + (mo.marketSentiment || 'neutral') + '</span>' +
            '</div><div class="text-sec text-sm">Updated: ' + relativeTime(d.timestamp) + ' — Select a tab above to explore protocols</div>';
        }
        document.getElementById('research-age').textContent = relativeTime(d.timestamp);
        updateSniper(d);
      }
    })
    .catch(function() {});
}

function runResearchCycle() {
  var btn = document.getElementById('research-run-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  log('RESEARCH', 'Background research cycle started...');
  fetch('/api/research/run', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      btn.disabled = false;
      btn.textContent = 'Background ↺';
      _latestReport = d;
      if (d) updateSniper(d);
      log('RESEARCH', 'Research cycle complete. BNB: $' + (d.marketOverview ? d.marketOverview.bnbPriceUsd.toFixed(2) : '?'));
    })
    .catch(function(e) {
      btn.disabled = false;
      btn.textContent = 'Background ↺';
      log('ERROR', 'Research run failed: ' + e.message);
    });
}

// ---------------------------------------------------------------------------
// Tab management
// ---------------------------------------------------------------------------
function selectResearchTab(tab) {
  // Update tab styles
  document.querySelectorAll('.rtab').forEach(function(el) { el.classList.remove('active'); });
  var tabs = document.querySelectorAll('.rtab');
  var tabNames = ['dex','lending','lp','yield','discover'];
  var idx = tabNames.indexOf(tab);
  if (idx >= 0 && tabs[idx]) tabs[idx].classList.add('active');

  // Hide all views
  document.getElementById('research-summary').style.display = 'none';
  document.getElementById('research-view-category').style.display = 'none';
  document.getElementById('research-view-deepdive').style.display = 'none';
  document.getElementById('research-view-discover').style.display = 'none';

  if (tab === 'discover') {
    document.getElementById('research-view-discover').style.display = 'block';
    loadDiscoveries();
  } else {
    _activeCategory = tab;
    document.getElementById('research-view-category').style.display = 'block';
    document.getElementById('category-view-title').textContent = 'TOP PROTOCOLS IN ' + tab.toUpperCase();
    loadCategoryProtocols(tab);
  }
}

function refreshCategory() {
  if (_activeCategory) loadCategoryProtocols(_activeCategory);
}

function backToCategory() {
  document.getElementById('research-view-deepdive').style.display = 'none';
  document.getElementById('research-view-category').style.display = 'block';
}

// ---------------------------------------------------------------------------
// Category protocol list
// ---------------------------------------------------------------------------
function formatTvl(v) {
  if (!v) return '$0';
  if (v >= 1e9) return '$' + (v/1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v/1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v/1e3).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
}

function loadCategoryProtocols(category) {
  var list = document.getElementById('category-list');
  list.innerHTML = '<div class="text-sec text-sm"><span class="spinner"></span>Loading ' + category + ' protocols...</div>';
  fetch('/api/research/category/' + category)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.protocols || d.protocols.length === 0) {
        list.innerHTML = '<div class="text-sec text-sm">No protocols found. Try running a discovery scan first.</div>';
        return;
      }
      var html = '';
      d.protocols.forEach(function(p) {
        html += '<div class="proto-row">' +
          '<span class="proto-name">' + escapeHtml(p.name) + '</span>' +
          '<div class="proto-meta">' +
            '<span><span class="label">TVL</span><span class="value">' + formatTvl(p.tvlUsd) + '</span></span>' +
            '<span><span class="label">24h Vol</span><span class="value">' + formatTvl(p.volume24h) + '</span></span>' +
          '</div>' +
          '<button class="btn btn-sec btn-sm" onclick="loadDeepDive(\\'' + escapeHtml(p.slug) + '\\')">Dive →</button>' +
          '</div>';
      });
      list.innerHTML = html;
      log('RESEARCH', 'Loaded ' + d.protocols.length + ' protocols in ' + category);
    })
    .catch(function(e) {
      list.innerHTML = '<div style="color:var(--red);font-size:12px">Error: ' + escapeHtml(e.message) + '</div>';
      log('ERROR', 'Category load failed: ' + e.message);
    });
}

// ---------------------------------------------------------------------------
// Deep dive
// ---------------------------------------------------------------------------
function loadDeepDive(slug) {
  document.getElementById('research-view-category').style.display = 'none';
  document.getElementById('research-view-deepdive').style.display = 'block';
  document.getElementById('deepdive-title').textContent = slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g,' ') + ' — Deep Dive';
  document.getElementById('deepdive-best').innerHTML = '<div class="text-sec text-sm"><span class="spinner"></span>Loading...</div>';
  document.getElementById('deepdive-other').innerHTML = '';
  document.getElementById('deepdive-brief').textContent = 'Loading strategy brief...';
  document.getElementById('deepdive-charts').innerHTML = '';
  document.getElementById('deepdive-risk').innerHTML = '';

  var walletParam = _wallet ? '?wallet=' + encodeURIComponent(_wallet) : '';
  log('RESEARCH', 'Loading deep dive: ' + slug);

  fetch('/api/research/protocol/' + encodeURIComponent(slug) + walletParam)
    .then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || r.statusText); });
      return r.json();
    })
    .then(function(report) {
      renderDeepDive(report);
      log('RESEARCH', 'Deep dive loaded: ' + report.protocolName + ' (' + report.pools.length + ' pools)');
    })
    .catch(function(e) {
      document.getElementById('deepdive-best').innerHTML = '<div style="color:var(--red);font-size:12px">Error: ' + escapeHtml(e.message) + '</div>';
      log('ERROR', 'Deep dive failed: ' + e.message);
    });
}

function renderPoolRow(pool) {
  var ilCls = pool.ilRisk === 'none' || pool.ilRisk === 'low' ? 'low' : pool.ilRisk === 'medium' ? 'medium' : 'high';
  var ilLabel = pool.ilRisk === 'none' ? 'No IL' : 'IL: ' + pool.ilRisk;
  return '<div class="pool-row ' + (pool.isHighlighted ? 'highlighted' : 'other') + '">' +
    '<span class="pool-symbol">' + escapeHtml(pool.symbol) + '</span>' +
    '<span class="pool-apy">' + pool.apy.toFixed(1) + '%</span>' +
    '<span class="pool-tvl">' + formatTvl(pool.tvlUsd) + '</span>' +
    '<span class="pool-il ' + ilCls + '">' + ilLabel + '</span>' +
    '<span class="text-sec" style="font-size:10px">' + pool.poolType + '</span>' +
    '</div>';
}

function renderDeepDive(report) {
  // Title
  document.getElementById('deepdive-title').textContent = report.protocolName + ' — Deep Dive';

  // Pools: highlighted (top 3) vs other (4-5)
  var highlighted = (report.pools || []).filter(function(p) { return p.isHighlighted; });
  var other = (report.pools || []).filter(function(p) { return !p.isHighlighted; });

  document.getElementById('deepdive-best').innerHTML = highlighted.length
    ? highlighted.map(renderPoolRow).join('')
    : '<div class="text-sec text-sm">No yield pools found for this protocol on BSC.</div>';

  var otherHeader = document.getElementById('other-pools-header');
  if (other.length > 0) {
    otherHeader.style.display = 'block';
    document.getElementById('deepdive-other').innerHTML = other.map(renderPoolRow).join('');
  } else {
    otherHeader.style.display = 'none';
    document.getElementById('deepdive-other').innerHTML = '';
  }

  // Strategy brief
  document.getElementById('deepdive-brief').textContent = report.strategyBrief || 'No strategy brief available.';

  // Charts — all data comes from API JSON, rendered by renderChart()
  var chartsEl = document.getElementById('deepdive-charts');
  chartsEl.innerHTML = '';
  if (report.charts && report.charts.length > 0) {
    report.charts.forEach(function(chartConfig, i) {
      var canvasId = 'dd-chart-' + i;
      chartsEl.innerHTML += '<div class="chart-wrap"><div class="chart-title">' + escapeHtml(chartConfig.title) + '</div>' +
        '<canvas id="' + canvasId + '" height="120"></canvas></div>';
    });
    // Render after DOM is updated
    setTimeout(function() {
      report.charts.forEach(function(chartConfig, i) {
        renderChart('dd-chart-' + i, chartConfig);
      });
    }, 0);
  } else {
    chartsEl.innerHTML = '<div class="text-sec text-sm">No chart data available yet.</div>';
  }

  // Risk badges
  var risk = report.risk || {};
  var badges = '';
  badges += '<span class="risk-badge ' + (risk.isAudited ? 'rb-green' : 'rb-red') + '">' + (risk.isAudited ? '✓ Audited' : '⚠ No Audit') + '</span>';
  badges += '<span class="risk-badge ' + (risk.contractVerified ? 'rb-green' : 'rb-yellow') + '">' + (risk.contractVerified ? '✓ Verified' : '? Unverified') + '</span>';
  var trendIcon = risk.tvlTrend === 'growing' ? '↑' : risk.tvlTrend === 'declining' ? '↓' : '→';
  var trendCls = risk.tvlTrend === 'growing' ? 'rb-green' : risk.tvlTrend === 'declining' ? 'rb-red' : 'rb-blue';
  badges += '<span class="risk-badge ' + trendCls + '">' + trendIcon + ' TVL ' + (risk.tvlTrend || 'unknown') + '</span>';
  badges += '<span class="risk-badge rb-blue">Liquidity: ' + (risk.liquidityDepth || '?') + '</span>';
  if (risk.ageMonths) badges += '<span class="risk-badge rb-blue">Age: ' + risk.ageMonths + 'mo</span>';
  if (risk.flags && risk.flags.length > 0) {
    risk.flags.forEach(function(flag) {
      badges += '<span class="risk-badge rb-yellow" title="' + escapeHtml(flag) + '">⚠ ' + escapeHtml(flag.slice(0, 40)) + (flag.length > 40 ? '…' : '') + '</span>';
    });
  }
  document.getElementById('deepdive-risk').innerHTML = badges;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
function loadDiscoveries() {
  var list = document.getElementById('discovery-list');
  list.innerHTML = '<div class="text-sec text-sm"><span class="spinner"></span>Loading...</div>';
  fetch('/api/research/discoveries')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var lastRun = document.getElementById('disc-last');
      lastRun.textContent = d.lastRunAt ? 'Last: ' + relativeTime(d.lastRunAt) : 'Never run';
      if (!d.protocols || d.protocols.length === 0) {
        list.innerHTML = '<div class="text-sec text-sm">No protocols discovered yet. Click Scan Now.</div>';
        return;
      }
      var html = '';
      d.protocols.forEach(function(p) {
        var verifiedBadge = p.verified
          ? ''
          : '<span class="badge-unverified">⚠ Unverified</span>';
        var actionBtn = p.verified
          ? '<button class="btn btn-sec btn-sm" onclick="loadDeepDive(\\'' + escapeHtml(p.slug) + '\\')">Research →</button>'
          : '<span class="text-sec text-sm">Not researchable</span>';
        html += '<div class="discovery-row">' +
          '<span class="disc-name">' + escapeHtml(p.name) + '</span>' +
          '<span class="disc-meta">' + p.category + ' · ' + formatTvl(p.tvlUsd) + ' · ' + relativeTime(p.discoveredAt) + '</span>' +
          verifiedBadge + actionBtn +
          '</div>';
      });
      list.innerHTML = html;
    })
    .catch(function(e) {
      list.innerHTML = '<div style="color:var(--red);font-size:12px">Error: ' + escapeHtml(e.message) + '</div>';
    });
}

function runDiscovery() {
  var btn = document.getElementById('disc-scan-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  log('RESEARCH', 'Protocol discovery scan started...');
  fetch('/api/research/discover', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      btn.disabled = false;
      btn.textContent = 'Scan Now';
      log('RESEARCH', 'Discovery complete: ' + d.newProtocols.length + ' new protocols found');
      loadDiscoveries();
    })
    .catch(function(e) {
      btn.disabled = false;
      btn.textContent = 'Scan Now';
      log('ERROR', 'Discovery failed: ' + e.message);
    });
}

// =============================================================================
// Buddy Panel
// =============================================================================
var STAGE_INFO = [
  { stage: 'seedling', label: 'Seedling', next: 100, color: '#0ECB81', bg: 'linear-gradient(135deg,#0ECB81,#0a9960)', emoji: '🌱' },
  { stage: 'sprout',   label: 'Sprout',   next: 500, color: '#8BC34A', bg: 'linear-gradient(135deg,#8BC34A,#5d8a1e)', emoji: '🌿' },
  { stage: 'bloom',    label: 'Bloom',    next: 2000, color: '#F0B90B', bg: 'linear-gradient(135deg,#F0B90B,#b88900)', emoji: '🌸' },
  { stage: 'guardian', label: 'Guardian', next: 5000, color: '#1890FF', bg: 'linear-gradient(135deg,#1890FF,#0050b3)', emoji: '🔵' },
  { stage: 'apex',     label: 'Apex',     next: 9999, color: '#B659FF', bg: 'linear-gradient(135deg,#B659FF,#7c1eb3)', emoji: '⚡' }
];

function getStageInfo(xp) {
  for (var i = STAGE_INFO.length - 1; i >= 0; i--) {
    if (xp >= (i === 0 ? 0 : STAGE_INFO[i-1].next)) return STAGE_INFO[i];
  }
  return STAGE_INFO[0];
}

function getStageStart(idx) {
  return idx === 0 ? 0 : STAGE_INFO[idx-1].next;
}

function updateBuddyPanel(buddy) {
  if (!buddy) return;
  _buddyXp = buddy.xp || 0;
  var idx = STAGE_INFO.findIndex(function(s) { return s.stage === buddy.stage; });
  if (idx < 0) idx = 0;
  var info = STAGE_INFO[idx];
  var stageStart = getStageStart(idx);
  var stageEnd = info.next;
  var pct = idx >= STAGE_INFO.length - 1 ? 100 : Math.min(100, Math.round((_buddyXp - stageStart) / (stageEnd - stageStart) * 100));
  document.getElementById('buddy-avatar').style.background = info.bg;
  document.getElementById('buddy-avatar').textContent = info.emoji;
  document.getElementById('buddy-stage-label').textContent = info.label;
  document.getElementById('buddy-level').textContent = buddy.level || 1;
  document.getElementById('buddy-xp-fill').style.width = pct + '%';
  document.getElementById('buddy-xp-label').textContent = _buddyXp + ' / ' + stageEnd + ' XP';
  var moodEmoji = { ecstatic: '🤩', happy: '😊', neutral: '😐', worried: '😟', anxious: '😰' };
  document.getElementById('buddy-mood').textContent = (moodEmoji[buddy.mood] || '😐') + ' ' + (buddy.mood || 'neutral');
  document.getElementById('buddy-trades').textContent = buddy.totalTradesExecuted || 0;
  var trEl = document.getElementById('buddy-trenches');
  if (buddy.trenchesUnlocked) {
    trEl.className = 'badge badge-orange';
    trEl.textContent = '⚡ Unlocked';
    document.getElementById('sniper-btn').disabled = false;
    document.getElementById('trenches-lock-badge').className = 'badge badge-orange';
    document.getElementById('trenches-lock-badge').textContent = '⚡ Trenches Active';
  } else {
    trEl.className = 'badge badge-red';
    trEl.textContent = '🔒 Locked';
    document.getElementById('trenches-lock-badge').textContent = '🔒 Locked (need 500 XP)';
  }
}

function loadBuddy() {
  fetch('/api/buddy')
    .then(function(r) { return r.json(); })
    .then(function(d) { updateBuddyPanel(d); log('INFO', 'Buddy loaded: ' + d.stage + ' Lv.' + d.level + ' (' + d.xp + ' XP)'); })
    .catch(function() {});
}

// =============================================================================
// Chat
// =============================================================================
function chatAppend(type, text, extra) {
  var msgs = document.getElementById('chat-messages');
  var div = document.createElement('div');
  var prefix = '';
  if (type === 'user') {
    div.className = 'msg msg-user';
    prefix = '<div class="msg-prefix">You</div>';
  } else if (type === 'buddy') {
    div.className = 'msg msg-buddy';
    prefix = '<div class="msg-prefix">🤖 Buddy</div>';
  } else if (type === 'tool') {
    div.className = 'msg msg-system tool';
  } else if (type === 'xp') {
    div.className = 'msg msg-system xp';
  } else if (type === 'error') {
    div.className = 'msg msg-system error';
  } else {
    div.className = 'msg msg-system';
  }
  div.innerHTML = prefix + '<div class="msg-bubble">' + escapeHtml(text) + '</div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function chatSend() {
  var input = document.getElementById('chat-input');
  var btn = document.getElementById('chat-send-btn');
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  btn.disabled = true;
  chatAppend('user', msg);
  document.getElementById('typing-indicator').style.display = 'block';
  log('CHAT', 'User: ' + msg.slice(0, 80));

  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, walletAddress: _wallet || undefined, mode: _mode, history: _chatHistory })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    document.getElementById('typing-indicator').style.display = 'none';
    btn.disabled = false;
    chatAppend('buddy', d.reply || '(no response)');
    if (d.toolName) {
      chatAppend('tool', '[TOOL] ' + d.toolName);
      log('TOOL', d.toolName + ' called');
    }
    if (d.xpAwarded > 0) {
      chatAppend('xp', '+' + d.xpAwarded + ' XP');
      log('XP', '+' + d.xpAwarded + ' XP awarded');
    }
    if (d.circuitBreakerTripped) {
      document.getElementById('cb-banner').style.display = 'block';
      log('ERROR', 'Circuit breaker tripped');
    }
    if (d.history) _chatHistory = d.history;
    if (d.buddyState) updateBuddyPanel(d.buddyState);
    log('AGENT', d.reply ? d.reply.slice(0, 100) : 'no reply');
    loadCbStatus();
  })
  .catch(function(e) {
    document.getElementById('typing-indicator').style.display = 'none';
    btn.disabled = false;
    chatAppend('error', 'Error: ' + e.message);
    log('ERROR', 'Chat error: ' + e.message);
  });
}

function resetCB() {
  fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'reset' }) })
    .then(function() { loadCbStatus(); document.getElementById('cb-banner').style.display = 'none'; log('INFO', 'Circuit breaker reset'); });
}

// =============================================================================
// Trade
// =============================================================================
function tradeGetQuote() {
  var tokenIn = document.getElementById('trade-from').value.trim() || 'BNB';
  var tokenOut = document.getElementById('trade-to').value.trim();
  var amountStr = document.getElementById('trade-amount').value.trim();
  var errEl = document.getElementById('trade-error');
  errEl.style.display = 'none';
  if (!tokenOut || !amountStr) { errEl.textContent = 'Fill in all fields'; errEl.style.display = 'block'; return; }
  var amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) { errEl.textContent = 'Invalid amount'; errEl.style.display = 'block'; return; }
  var slippage = _mode === 'trenches' ? 1500 : 100;
  log('TRADE', 'Getting quote: ' + amount + ' ' + tokenIn + ' → ' + tokenOut);
  document.getElementById('quote-card').style.display = 'none';
  document.getElementById('trade-actions').style.display = 'none';
  document.getElementById('tx-result').style.display = 'none';
  _pendingQuote = null;

  fetch('/api/swap/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenIn: tokenIn, tokenOut: tokenOut, amountBnb: amount, slippageBps: slippage })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; log('ERROR', 'Quote: ' + d.error); return; }
    _pendingQuote = d;
    renderQuote(d, tokenIn, tokenOut, slippage);
    log('TRADE', 'Quote: ' + formatNum(parseFloat(d.quote.amountIn) / 1e18) + ' ' + tokenIn + ' → ' + escapeHtml(tokenOut));
  })
  .catch(function(e) { errEl.textContent = e.message; errEl.style.display = 'block'; log('ERROR', 'Quote fetch: ' + e.message); });
}

function renderQuote(d, tokenIn, tokenOut, slippage) {
  var q = d.quote;
  var g = d.guardrail;
  var amtIn = formatNum(parseFloat(q.amountIn) / 1e18);
  var amtOut = formatNum(parseFloat(q.amountOut) / 1e18);
  document.getElementById('q-amount-in').textContent = amtIn + ' ' + tokenIn;
  document.getElementById('q-amount-out').textContent = amtOut + ' ' + tokenOut;
  var impactPct = q.priceImpact || 0;
  var impactColor = impactPct < 1 ? 'var(--green)' : impactPct < 3 ? 'var(--orange)' : 'var(--red)';
  document.getElementById('q-impact').innerHTML = '<span style="color:' + impactColor + '">' + impactPct.toFixed(2) + '%</span>';
  document.getElementById('q-gas').textContent = formatNum(parseFloat(q.gasCostBnb || '0')) + ' BNB ($' + (q.gasCostUsd || 0).toFixed(2) + ')';
  document.getElementById('q-slippage').textContent = (slippage / 100).toFixed(1) + '% (' + (_mode === 'trenches' ? 'Trenches' : 'Normal') + ')';
  document.getElementById('q-route').textContent = (q.path || []).join(' → ');
  // Guardrails
  var html = '';
  if (g && g.checks) {
    var checks = g.checks;
    for (var k in checks) {
      var pass = checks[k];
      html += '<div class="guardrail-row ' + (pass ? 'guardrail-pass' : 'guardrail-fail') + '">' +
              (pass ? '✅' : '❌') + ' ' + k + '</div>';
    }
  }
  document.getElementById('q-guardrails').innerHTML = html;
  document.getElementById('quote-card').style.display = 'block';
  if (g && g.passed) {
    document.getElementById('trade-actions').style.display = 'flex';
    log('TRADE', 'Guardrails PASSED — ready to execute');
  } else {
    log('TRADE', 'Guardrails FAILED: ' + (g ? g.failureReason : 'unknown'));
  }
}

function tradeCancel() {
  _pendingQuote = null;
  document.getElementById('quote-card').style.display = 'none';
  document.getElementById('trade-actions').style.display = 'none';
  document.getElementById('tx-result').style.display = 'none';
  log('TRADE', 'Swap cancelled by user');
}

function tradeExecute() {
  if (!_pendingQuote) return;
  var tokenIn = document.getElementById('trade-from').value.trim() || 'BNB';
  var tokenOut = document.getElementById('trade-to').value.trim();
  var amount = parseFloat(document.getElementById('trade-amount').value.trim());
  var slippage = _mode === 'trenches' ? 1500 : 100;
  document.getElementById('trade-actions').style.display = 'none';
  var resEl = document.getElementById('tx-result');
  resEl.innerHTML = '<span class="spinner"></span> Submitting to BSC Mainnet...';
  resEl.style.display = 'block';
  log('TRADE', 'Executing swap: ' + amount + ' ' + tokenIn + ' → ' + tokenOut);

  fetch('/api/swap/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenIn: tokenIn, tokenOut: tokenOut, amountBnb: amount, slippageBps: slippage, quote: _pendingQuote.quote })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    _pendingQuote = null;
    if (d.success) {
      var txLink = 'https://bscscan.com/tx/' + d.txHash;
      resEl.innerHTML = '<div style="color:var(--green);font-weight:600;margin-bottom:6px">✅ Swap Executed!</div>' +
        '<div class="text-sm">Tx: <a href="' + txLink + '" target="_blank" style="color:var(--blue)">' + d.txHash.slice(0,10) + '...' + d.txHash.slice(-6) + ' ↗</a></div>' +
        '<div class="text-sm text-sec">Amount out: ' + formatNum(parseFloat(d.amountOut) / 1e18) + ' ' + tokenOut + '</div>' +
        '<div class="text-sm text-sec">Gas used: ' + d.gasUsed + '</div>';
      log('TRADE', 'Swap success! Tx: ' + d.txHash.slice(0,10) + '...');
      if (d.buddyState) updateBuddyPanel(d.buddyState);
      loadHeader(); // refresh BNB balance
    } else {
      resEl.innerHTML = '<div style="color:var(--red);font-weight:600">❌ Swap Failed</div>' +
        '<div class="text-sm text-sec" style="margin-top:4px">' + escapeHtml(d.error || 'Unknown error') + '</div>';
      log('ERROR', 'Swap failed: ' + (d.error || 'unknown'));
    }
  })
  .catch(function(e) {
    _pendingQuote = null;
    resEl.innerHTML = '<div style="color:var(--red)">Error: ' + escapeHtml(e.message) + '</div>';
    log('ERROR', 'Execute error: ' + e.message);
  });
}

// =============================================================================
// Trenches
// =============================================================================
function updateSniper(report) {
  var pairs = (report && report.newPairs) || [];
  var el = document.getElementById('sniper-pairs');
  if (pairs.length === 0) { el.innerHTML = '<div class="text-sec text-sm">No pairs detected yet.</div>'; return; }
  var html = '';
  for (var i = 0; i < Math.min(pairs.length, 5); i++) {
    var p = pairs[i];
    var riskCls = p.honeypotRisk === 'low' ? 'badge-green' : p.honeypotRisk === 'medium' ? 'badge-orange' : 'badge-red';
    html += '<div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px">' +
      '<strong>' + escapeHtml(p.token0Symbol) + '/' + escapeHtml(p.token1Symbol) + '</strong>' +
      ' <span class="badge ' + riskCls + '">' + escapeHtml(p.honeypotRisk) + ' risk</span>' +
      '<div class="text-sec">Liq: ' + (p.initialLiquidityBnb || 0).toFixed(2) + ' BNB · ' +
      (p.isLiquidityLocked ? '🔒 Renounced' : '⚠️ Owner held') + '</div>' +
      '</div>';
  }
  el.innerHTML = html;
}

function activateSniper() {
  if (_mode !== 'trenches') { setMode('trenches'); }
  log('TRENCHES', 'Activating sniper via agent...');
  fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'start sniper', walletAddress: _wallet || undefined, mode: 'trenches' })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.reply) chatAppend('buddy', d.reply);
    _sniperActive = true;
    document.getElementById('sniper-dot').className = 'sniper-dot active';
    document.getElementById('sniper-status-label').textContent = 'Active — watching PairCreated';
    document.getElementById('sniper-btn').textContent = 'Active';
    document.getElementById('sniper-btn').disabled = true;
    log('TRENCHES', 'Sniper activated');
    if (d.buddyState) updateBuddyPanel(d.buddyState);
  })
  .catch(function(e) { log('ERROR', 'Sniper activation: ' + e.message); });
}

function scanFarms() {
  var btn = document.getElementById('farms-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  log('TRENCHES', 'Scanning farms...');
  fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'find farms', walletAddress: _wallet || undefined, mode: _mode })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    btn.disabled = false;
    btn.textContent = 'Scan Farms';
    var farms = (_latestReport && _latestReport.opportunities) || [];
    var html = '';
    if (farms.length > 0) {
      for (var i = 0; i < Math.min(farms.length, 5); i++) {
        var f = farms[i];
        var riskCls = f.riskScore <= 3 ? 'risk-low' : f.riskScore <= 6 ? 'risk-med' : 'risk-high';
        var apyCls = f.apy >= 20 ? 'apy-high' : f.apy >= 10 ? 'apy-mid' : '';
        html += '<div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px">' +
          '<strong>' + escapeHtml(f.poolName) + '</strong> (' + escapeHtml(f.protocol) + ')' +
          '<div><span class="' + apyCls + '">' + f.apy.toFixed(1) + '% APY</span>' +
          ' · Risk: <span class="' + riskCls + '">' + f.riskScore + '/10</span>' +
          ' · IL: ' + escapeHtml(f.impermanentLossRisk || '-') + '</div>' +
          '</div>';
      }
    } else {
      html = '<div class="text-sec text-sm">' + escapeHtml(d.reply || 'No farms found') + '</div>';
    }
    document.getElementById('farms-results').innerHTML = html;
    log('TRENCHES', 'Farm scan complete. ' + farms.length + ' opportunities found.');
    if (d.buddyState) updateBuddyPanel(d.buddyState);
  })
  .catch(function(e) {
    btn.disabled = false;
    btn.textContent = 'Scan Farms';
    log('ERROR', 'Farm scan: ' + e.message);
  });
}

// =============================================================================
// Wallet Scanner
// =============================================================================
function scanWallet() {
  var input = document.getElementById('scan-input');
  var btn = document.getElementById('scan-btn');
  var address = input.value.trim();
  if (!address) { input.focus(); return; }
  btn.disabled = true;
  document.getElementById('scan-result').innerHTML = '<div class="text-sec text-sm"><span class="spinner"></span>Scanning...</div>';
  log('INFO', 'Scanning wallet: ' + address.slice(0,6) + '...');
  fetch('/api/scan/' + address, { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      btn.disabled = false;
      if (d.error) { document.getElementById('scan-result').innerHTML = '<div style="color:var(--red)">' + escapeHtml(d.error) + '</div>'; log('ERROR', 'Scan: ' + d.error); return; }
      renderScan(d);
      log('INFO', 'Scan done: $' + (d.walletState.totalValueUsd || 0).toFixed(2) + ' · ' + (d.walletState.tokens || []).length + ' tokens');
    })
    .catch(function(e) { btn.disabled = false; document.getElementById('scan-result').innerHTML = '<div style="color:var(--red)">' + escapeHtml(e.message) + '</div>'; log('ERROR', 'Scan: ' + e.message); });
}

function renderScan(data) {
  var ws = data.walletState; var p = data.profile;
  var archEmoji = { newcomer: '🌱', holder: '💎', swapper: '🔄', farmer: '🌾', degen: '🎰', unknown: '❓' };
  var html = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">' +
    statCard('BNB', (ws.bnbBalanceFormatted||0).toFixed(4)) +
    statCard('Total', formatUsd(ws.totalValueUsd)) +
    statCard('Tokens', (ws.tokens||[]).length) +
    statCard('Archetype', (archEmoji[p.archetype]||'❓') + ' ' + p.archetype) +
    '</div>';
  var tokens = (ws.tokens||[]).sort(function(a,b){return b.valueUsd-a.valueUsd;}).slice(0,8);
  if (tokens.length > 0) {
    html += '<table class="token-table"><thead><tr><th>Symbol</th><th>Balance</th><th>Price</th><th>Value</th></tr></thead><tbody>';
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      html += '<tr><td><strong>' + escapeHtml(t.symbol) + '</strong></td>' +
              '<td>' + formatNum(t.balanceFormatted) + '</td>' +
              '<td>$' + formatNum(t.priceUsd) + '</td>' +
              '<td style="color:' + (t.valueUsd > 0 ? 'var(--green)' : 'var(--text-secondary)') + '">$' + formatNum(t.valueUsd) + '</td></tr>';
    }
    html += '</tbody></table>';
  }
  document.getElementById('scan-result').innerHTML = html;
}

function statCard(label, value) {
  return '<div style="background:var(--bg-tertiary);border-radius:var(--radius-sm);padding:8px;text-align:center">' +
    '<div style="font-size:14px;font-weight:600;font-family:\\'Space Grotesk\\',sans-serif">' + escapeHtml(String(value)) + '</div>' +
    '<div class="text-sec text-sm">' + escapeHtml(label) + '</div></div>';
}

// =============================================================================
// Test Runner
// =============================================================================
function runTests() {
  var btn = document.getElementById('test-btn');
  var results = document.getElementById('test-results');
  btn.disabled = true;
  results.innerHTML = '<div class="text-sec text-sm"><span class="spinner"></span>Running tests...</div>';
  fetch('/api/tests')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      btn.disabled = false;
      if (d.raw) { results.innerHTML = '<pre style="font-size:11px;color:var(--text-secondary);white-space:pre-wrap">' + escapeHtml(d.raw) + '</pre>'; return; }
      var passed = d.numPassedTests || 0;
      var failed = d.numFailedTests || 0;
      var total = d.numTotalTests || 0;
      var color = failed > 0 ? 'var(--red)' : 'var(--green)';
      var html = '<div style="font-size:14px;margin-bottom:8px"><span style="color:' + color + ';font-weight:600">' + passed + ' passed</span>';
      if (failed > 0) html += ' / <span style="color:var(--red)">' + failed + ' failed</span>';
      html += ' / ' + total + ' total</div>';
      var suites = d.testResults || [];
      for (var i = 0; i < suites.length; i++) {
        var s = suites[i];
        var name = s.name ? s.name.split('/').slice(-2).join('/') : 'Unknown';
        html += '<div style="margin-bottom:8px;font-size:12px"><div style="color:' + (s.status === 'passed' ? 'var(--green)' : 'var(--red)') + ';font-weight:600;margin-bottom:2px">' + (s.status === 'passed' ? '✓' : '✗') + ' ' + escapeHtml(name) + '</div>';
        var tests = s.assertionResults || [];
        for (var j = 0; j < tests.length; j++) {
          var t = tests[j];
          html += '<div style="color:' + (t.status === 'passed' ? 'var(--text-secondary)' : 'var(--red)') + ';padding-left:12px">' + (t.status === 'passed' ? '· ' : '✗ ') + escapeHtml(t.title || t.fullName || '') + '</div>';
        }
        html += '</div>';
      }
      results.innerHTML = html;
      log('INFO', 'Tests: ' + passed + '/' + total + ' passed');
    })
    .catch(function(e) { btn.disabled = false; results.innerHTML = '<div style="color:var(--red)">' + escapeHtml(e.message) + '</div>'; });
}

// =============================================================================
// Init
// =============================================================================
window.onload = function() {
  log('INFO', 'Dashboard loaded');
  loadHeader();
  runHealth();
  loadResearchSummary();
  loadBuddy();
  // Poll research every 60s
  setInterval(loadResearchSummary, 60000);
  // Poll agent wallet balance every 30s
  setInterval(function() {
    fetch('/api/agent-wallet').then(function(r){return r.json();}).then(function(d){
      if (d.configured && d.bnbBalanceFormatted != null) {
        document.getElementById('aw-bal').textContent = d.bnbBalanceFormatted.toFixed(4) + ' BNB';
      }
    }).catch(function(){});
  }, 30000);
};
</script>

</body>
</html>`;
