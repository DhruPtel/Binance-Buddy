import 'dotenv/config';
// =============================================================================
// @binancebuddy/server — Dev Dashboard & API
// =============================================================================

import express, { type Express } from 'express';
import cors from 'cors';
import { execSync } from 'child_process';
import {
  createProvider,
  checkProviderHealth,
  scanWallet,
  buildProfile,
  getBnbPriceUsd,
} from '@binancebuddy/blockchain';
import { safeStringify } from '@binancebuddy/core';

const app: Express = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ?? 3000;
const ANKR_API_KEY = process.env.ANKR_API_KEY ?? ''; // optional — paid, enables tx history
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY ?? '';

// Reusable provider
const provider = createProvider('mainnet', process.env.BSC_RPC_URL || undefined);

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/api/health', async (_req, res) => {
  const results: Record<string, { status: string; detail?: string }> = {};

  // Provider
  try {
    const block = await checkProviderHealth(provider);
    results.provider = { status: 'ok', detail: `Block #${block}` };
  } catch (e) {
    results.provider = { status: 'error', detail: String(e) };
  }

  // Multicall3 (canary call — checks the contract is reachable)
  try {
    const r = await fetch(process.env.BSC_RPC_URL || 'https://rpc.ankr.com/bsc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'eth_getCode',
        params: ['0xcA11bde05977b3631167028862bE2a173976CA11', 'latest'],
        id: 1,
      }),
    });
    const j = (await r.json()) as { result?: string };
    const hasCode = j.result && j.result !== '0x';
    results.multicall3 = {
      status: hasCode ? 'ok' : 'warning',
      detail: hasCode ? 'Multicall3 reachable on BSC' : 'No bytecode — wrong network?',
    };
  } catch (e) {
    results.multicall3 = { status: 'error', detail: String(e) };
  }

  // CoinGecko
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
    const fullProfile = await buildProfile(address, walletState.tokens, ANKR_API_KEY || undefined);

    res.type('application/json').send(safeStringify({ walletState, profile: fullProfile }));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Test runner
app.get('/api/tests', (_req, res) => {
  try {
    const output = execSync('pnpm exec vitest run --reporter=json 2>/dev/null || true', {
      cwd: process.cwd(),
      timeout: 60000,
      encoding: 'utf-8',
    });

    // Find the JSON portion of the output
    const jsonStart = output.indexOf('{');
    if (jsonStart === -1) {
      res.json({ raw: output });
      return;
    }
    const jsonStr = output.slice(jsonStart);
    try {
      const parsed = JSON.parse(jsonStr);
      res.json(parsed);
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

app.listen(PORT, () => {
  console.log(`\n  Binance Buddy Dev Dashboard`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  API:`);
  console.log(`    GET  /api/health`);
  console.log(`    POST /api/scan/:address`);
  console.log(`    GET  /api/tests\n`);
  if (ANKR_API_KEY) {
    console.log(`  ℹ  ANKR_API_KEY set — tx history enabled`);
  } else {
    console.log(`  ℹ  No ANKR_API_KEY — tx history disabled (wallet scan still works via Multicall3)`);
  }
});

export { app };

// ---------------------------------------------------------------------------
// Dashboard HTML (inline)
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
    --text-primary: #EAECEF; --text-secondary: #848E9C; --text-tertiary: #5E6673;
    --green: #0ECB81; --red: #F6465D; --blue: #1890FF; --orange: #FF8C00; --purple: #B659FF;
    --radius-sm: 6px; --radius-md: 10px;
    --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
    --shadow-glow: 0 0 20px rgba(240,185,11,0.3);
  }
  body {
    background: var(--bg-primary); color: var(--text-primary);
    font-family: 'IBM Plex Sans', -apple-system, sans-serif; font-size: 15px; line-height: 1.5;
    padding: 32px; max-width: 1200px; margin: 0 auto;
  }
  h1 { font-family: 'Space Grotesk', sans-serif; font-size: 24px; font-weight: 700; color: var(--gold); margin-bottom: 8px; }
  h2 { font-family: 'Space Grotesk', sans-serif; font-size: 17px; font-weight: 600; margin-bottom: 12px; }
  .subtitle { color: var(--text-secondary); font-size: 13px; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
  .card {
    background: var(--bg-secondary); border-radius: var(--radius-md); padding: 20px;
    border: 1px solid rgba(255,255,255,0.06); box-shadow: var(--shadow-md);
  }
  .card-full { grid-column: 1 / -1; }
  input[type="text"] {
    background: var(--bg-tertiary); border: 1px solid transparent; border-radius: var(--radius-sm);
    padding: 10px 14px; color: var(--text-primary); font-family: 'JetBrains Mono', monospace;
    font-size: 13px; width: 100%; outline: none; transition: border 150ms ease, box-shadow 150ms ease;
  }
  input[type="text"]:focus { border-color: var(--gold); box-shadow: var(--shadow-glow); }
  input[type="text"]::placeholder { color: var(--text-tertiary); }
  .btn {
    background: var(--gold); color: var(--bg-primary); border: none; border-radius: var(--radius-sm);
    padding: 0 16px; height: 40px; font-weight: 600; font-size: 14px; cursor: pointer;
    transition: background 150ms ease; font-family: inherit;
  }
  .btn:hover { background: var(--gold-light); }
  .btn:active { background: var(--gold-dark); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    background: var(--bg-tertiary); color: var(--text-primary);
    border: 1px solid rgba(255,255,255,0.1);
  }
  .btn-secondary:hover { background: #363d47; }
  .input-row { display: flex; gap: 8px; margin-bottom: 16px; }
  .input-row input { flex: 1; }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
  .status-dot.ok { background: var(--green); }
  .status-dot.warning { background: var(--orange); }
  .status-dot.error { background: var(--red); }
  .status-dot.pending { background: var(--text-tertiary); }
  .status-row { display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 14px; }
  .status-row:last-child { border-bottom: none; }
  .status-label { font-weight: 500; width: 120px; }
  .status-detail { color: var(--text-secondary); font-size: 13px; }
  .result-box {
    background: var(--bg-primary); border-radius: var(--radius-sm); padding: 16px;
    font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.6;
    max-height: 500px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;
    margin-top: 12px; border: 1px solid rgba(255,255,255,0.04);
  }
  .result-box:empty { display: none; }
  .section-label { color: var(--gold); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .token-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  .token-table th { text-align: left; color: var(--text-secondary); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .token-table td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.03); }
  .token-table tr:hover td { background: rgba(255,255,255,0.02); }
  .mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
  .badge {
    display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600;
  }
  .badge-gold { background: rgba(240,185,11,0.15); color: var(--gold); }
  .badge-green { background: rgba(14,203,129,0.15); color: var(--green); }
  .badge-red { background: rgba(246,70,93,0.15); color: var(--red); }
  .badge-blue { background: rgba(24,144,255,0.15); color: var(--blue); }
  .badge-purple { background: rgba(182,89,255,0.15); color: var(--purple); }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 12px; }
  .stat-card { background: var(--bg-tertiary); border-radius: var(--radius-sm); padding: 12px; }
  .stat-value { font-size: 20px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; }
  .stat-label { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
  .test-pass { color: var(--green); }
  .test-fail { color: var(--red); }
  .test-item { padding: 4px 0; font-size: 13px; }
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--text-tertiary); border-top-color: var(--gold); border-radius: 50%; animation: spin 0.6s linear infinite; margin-right: 6px; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-text { color: var(--text-secondary); font-size: 13px; }
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
</style>
</head>
<body>

<h1>Binance Buddy</h1>
<p class="subtitle">Dev Dashboard — blockchain package testing</p>

<div class="grid">
  <!-- Health Panel -->
  <div class="card">
    <h2>System Health</h2>
    <div id="health-statuses">
      <div class="status-row"><span class="status-dot pending"></span><span class="status-label">Provider</span><span class="status-detail">Not checked</span></div>
      <div class="status-row"><span class="status-dot pending"></span><span class="status-label">Multicall3</span><span class="status-detail">Not checked</span></div>
      <div class="status-row"><span class="status-dot pending"></span><span class="status-label">CoinGecko</span><span class="status-detail">Not checked</span></div>
    </div>
    <div style="margin-top: 16px;">
      <button class="btn btn-secondary" onclick="runHealthCheck()">Run Health Check</button>
    </div>
  </div>

  <!-- Test Runner Panel -->
  <div class="card">
    <h2>Test Runner</h2>
    <div id="test-results">
      <p class="loading-text">Click to run all tests</p>
    </div>
    <div style="margin-top: 16px;">
      <button class="btn btn-secondary" onclick="runTests()" id="test-btn">Run Tests</button>
    </div>
  </div>

  <!-- Wallet Scanner Panel -->
  <div class="card card-full">
    <h2>Wallet Scanner</h2>
    <div class="input-row">
      <input type="text" id="wallet-input" placeholder="Enter BSC address (0x...)" />
      <button class="btn" onclick="scanWallet()" id="scan-btn">Scan</button>
    </div>
    <div id="scan-result"></div>
  </div>
</div>

<script>
async function runHealthCheck() {
  const container = document.getElementById('health-statuses');
  container.innerHTML = '<p class="loading-text"><span class="spinner"></span>Checking...</p>';
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    let html = '';
    for (const [name, info] of Object.entries(data)) {
      html += '<div class="status-row">' +
        '<span class="status-dot ' + info.status + '"></span>' +
        '<span class="status-label">' + name.charAt(0).toUpperCase() + name.slice(1) + '</span>' +
        '<span class="status-detail">' + (info.detail || '') + '</span>' +
        '</div>';
    }
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<p class="test-fail">Failed: ' + e.message + '</p>';
  }
}

async function runTests() {
  const container = document.getElementById('test-results');
  const btn = document.getElementById('test-btn');
  btn.disabled = true;
  container.innerHTML = '<p class="loading-text"><span class="spinner"></span>Running tests (may take ~30s)...</p>';
  try {
    const res = await fetch('/api/tests');
    const data = await res.json();
    if (data.raw) {
      container.innerHTML = '<div class="result-box">' + escapeHtml(data.raw) + '</div>';
      btn.disabled = false;
      return;
    }
    const suites = data.testResults || [];
    const numPassed = data.numPassedTests || 0;
    const numFailed = data.numFailedTests || 0;
    const numTotal = data.numTotalTests || 0;

    let html = '<div class="stat-grid">' +
      '<div class="stat-card"><div class="stat-value test-pass">' + numPassed + '</div><div class="stat-label">Passed</div></div>' +
      '<div class="stat-card"><div class="stat-value test-fail">' + numFailed + '</div><div class="stat-label">Failed</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + numTotal + '</div><div class="stat-label">Total</div></div>' +
      '</div>';

    html += '<div style="margin-top: 16px;">';
    for (const suite of suites) {
      const fileName = suite.name ? suite.name.split('/').slice(-3).join('/') : 'Unknown';
      const passed = suite.status === 'passed';
      html += '<div style="margin-bottom: 12px;">' +
        '<div class="section-label">' + (passed ? '✓ ' : '✗ ') + fileName + '</div>';
      const tests = suite.assertionResults || [];
      for (const t of tests) {
        const icon = t.status === 'passed' ? '✓' : '✗';
        const cls = t.status === 'passed' ? 'test-pass' : 'test-fail';
        html += '<div class="test-item"><span class="' + cls + '">' + icon + '</span> ' + escapeHtml(t.title || t.fullName || '') + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<p class="test-fail">Failed: ' + e.message + '</p>';
  }
  btn.disabled = false;
}

async function scanWallet() {
  const input = document.getElementById('wallet-input');
  const container = document.getElementById('scan-result');
  const btn = document.getElementById('scan-btn');
  const address = input.value.trim();
  if (!address) { input.focus(); return; }

  btn.disabled = true;
  container.innerHTML = '<p class="loading-text"><span class="spinner"></span>Scanning wallet (fetching tokens, prices, tx history)...</p>';

  try {
    const res = await fetch('/api/scan/' + address, { method: 'POST' });
    const data = await res.json();
    if (data.error) {
      container.innerHTML = '<p class="test-fail">' + escapeHtml(data.error) + '</p>';
      btn.disabled = false;
      return;
    }
    renderScanResult(data, container);
  } catch (e) {
    container.innerHTML = '<p class="test-fail">Failed: ' + e.message + '</p>';
  }
  btn.disabled = false;
}

function renderScanResult(data, container) {
  const ws = data.walletState;
  const p = data.profile;
  let html = '';

  // Stats
  html += '<div class="stat-grid">' +
    '<div class="stat-card"><div class="stat-value">' + (ws.bnbBalanceFormatted || 0).toFixed(4) + '</div><div class="stat-label">BNB Balance</div></div>' +
    '<div class="stat-card"><div class="stat-value">$' + (ws.totalValueUsd || 0).toFixed(2) + '</div><div class="stat-label">Total Value</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + (ws.tokens || []).length + '</div><div class="stat-label">Tokens</div></div>' +
    '<div class="stat-card"><div class="stat-value"><span class="badge badge-gold">' + (p.archetype || 'unknown') + '</span></div><div class="stat-label">Archetype</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + (p.riskScore || 0) + '/10</div><div class="stat-label">Risk Score</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + (p.totalTxCount || 0) + '</div><div class="stat-label">Total Txs</div></div>' +
    '<div class="stat-card"><div class="stat-value"><span class="badge badge-blue">' + (p.tradingFrequency || '-') + '</span></div><div class="stat-label">Frequency</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + (p.avgTradeSize || 0).toFixed(4) + '</div><div class="stat-label">Avg Trade (BNB)</div></div>' +
    '</div>';

  // Token table
  const tokens = ws.tokens || [];
  if (tokens.length > 0) {
    html += '<div style="margin-top: 20px;"><div class="section-label">Token Holdings</div>' +
      '<table class="token-table"><thead><tr><th>Symbol</th><th>Balance</th><th>Price</th><th>Value</th><th>Address</th></tr></thead><tbody>';
    for (const t of tokens) {
      html += '<tr>' +
        '<td><strong>' + escapeHtml(t.symbol) + '</strong></td>' +
        '<td>' + formatNum(t.balanceFormatted) + '</td>' +
        '<td>$' + formatNum(t.priceUsd) + '</td>' +
        '<td class="' + (t.valueUsd > 0 ? 'test-pass' : '') + '">$' + formatNum(t.valueUsd) + '</td>' +
        '<td class="mono">' + t.address.slice(0, 10) + '...' + t.address.slice(-6) + '</td>' +
        '</tr>';
    }
    html += '</tbody></table></div>';
  }

  // Protocols
  const protocols = p.protocols || [];
  if (protocols.length > 0) {
    html += '<div style="margin-top: 20px;"><div class="section-label">Protocol Usage</div>';
    for (const proto of protocols) {
      html += '<div style="padding: 4px 0; font-size: 13px;">' +
        '<span class="badge badge-purple">' + escapeHtml(proto.name) + '</span> ' +
        proto.interactionCount + ' interactions — ' + proto.category +
        '</div>';
    }
    html += '</div>';
  }

  // Raw JSON toggle
  html += '<div style="margin-top: 20px;">' +
    '<button class="btn btn-secondary" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\\'none\\'?\\'block\\':\\'none\\'">Toggle Raw JSON</button>' +
    '<div class="result-box" style="display:none;margin-top:8px;">' + escapeHtml(JSON.stringify(data, null, 2)) + '</div>' +
    '</div>';

  container.innerHTML = html;
}

function formatNum(n) {
  if (n == null) return '0';
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 0.0001) return n.toFixed(6);
  if (n > 0) return n.toExponential(2);
  return '0';
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

// Auto-run health check on load
runHealthCheck();
</script>

</body>
</html>`;
