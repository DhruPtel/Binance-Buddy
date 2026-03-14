// =============================================================================
// @binancebuddy/ai — Dune Analytics Client
// Executes predefined SQL query templates against BSC on-chain data.
// Uses DUNE_API_KEY from process.env.
//
// Features:
//   - 11 predefined templates loaded from dune-queries/ (3 lending, 3 LP, 3 yield, 2 common)
//   - Parameter filling with {{placeholder}} replacement
//   - Dune API v1: execute query → poll for results → return rows
//   - Monthly credit tracking persisted to data/dune-usage.json
//   - Returns null on failure (no key, quota exceeded, API error)
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

const DUNE_API_BASE = 'https://api.dune.com/api/v1';
const MONTHLY_CREDIT_LIMIT = 2500;
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 20; // 60s max wait

// ---------------------------------------------------------------------------
// Template registry — loaded once from .sql files
// ---------------------------------------------------------------------------

export interface QueryTemplate {
  name: string;          // filename without extension
  title: string;         // human-readable title from SQL comment
  category: string;      // lending | liquidity | yield | common
  sql: string;           // raw SQL with {{param}} placeholders
  params: string[];      // extracted parameter names
}

const TEMPLATE_DIR = resolve(dirname(new URL(import.meta.url).pathname), 'dune-queries');

const TEMPLATE_FILES: Array<{ file: string; category: string }> = [
  { file: 'lending_utilization.sql', category: 'lending' },
  { file: 'lending_flows.sql', category: 'lending' },
  { file: 'lending_liquidations.sql', category: 'lending' },
  { file: 'liquidity_volume.sql', category: 'liquidity' },
  { file: 'liquidity_fee_revenue.sql', category: 'liquidity' },
  { file: 'liquidity_top_lps.sql', category: 'liquidity' },
  { file: 'yield_net_flows.sql', category: 'yield' },
  { file: 'yield_performance.sql', category: 'yield' },
  { file: 'yield_compound_frequency.sql', category: 'yield' },
  { file: 'common_holder_concentration.sql', category: 'common' },
  { file: 'common_large_transfers.sql', category: 'common' },
];

let _templates: QueryTemplate[] | null = null;

function extractTitle(sql: string): string {
  const match = sql.match(/^-- Title:\s*(.+)$/m);
  return match?.[1]?.trim() ?? 'Untitled Query';
}

function extractParams(sql: string): string[] {
  const matches = sql.matchAll(/\{\{(\w+)\}\}/g);
  const seen = new Set<string>();
  for (const m of matches) {
    seen.add(m[1]!);
  }
  return Array.from(seen);
}

function loadTemplates(): QueryTemplate[] {
  if (_templates) return _templates;
  _templates = [];
  for (const entry of TEMPLATE_FILES) {
    try {
      const filePath = resolve(TEMPLATE_DIR, entry.file);
      const sql = readFileSync(filePath, 'utf8');
      const name = entry.file.replace(/\.sql$/, '');
      _templates.push({
        name,
        title: extractTitle(sql),
        category: entry.category,
        sql,
        params: extractParams(sql),
      });
    } catch (err) {
      console.error(`[dune] Failed to load template ${entry.file}:`, err);
    }
  }
  return _templates;
}

/**
 * Get templates for a given protocol category + common templates.
 */
export function getTemplatesForCategory(category: string): QueryTemplate[] {
  const all = loadTemplates();
  return all.filter((t) => t.category === category || t.category === 'common');
}

/**
 * Get all available templates.
 */
export function getAllTemplates(): QueryTemplate[] {
  return loadTemplates();
}

/**
 * Fill a template's {{param}} placeholders with values.
 * Values are quoted as Dune parameters (strings get single-quoted).
 */
export function fillTemplate(
  template: QueryTemplate,
  params: Record<string, string | number>,
): string {
  let sql = template.sql;
  for (const [key, value] of Object.entries(params)) {
    const placeholder = `{{${key}}}`;
    // Address params get single-quoted; numeric params stay raw
    const replacement = typeof value === 'number' ? String(value) : `'${value}'`;
    sql = sql.replaceAll(placeholder, replacement);
  }
  return sql;
}

// ---------------------------------------------------------------------------
// Credit tracking — persisted to data/dune-usage.json
// ---------------------------------------------------------------------------

interface DuneUsageRecord {
  month: string;   // "YYYY-MM"
  credits: number;
}

function getDataDir(): string {
  return resolve(process.cwd(), 'data');
}

function getDuneUsagePath(): string {
  return resolve(getDataDir(), 'dune-usage.json');
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function loadDuneUsage(): DuneUsageRecord {
  const path = getDuneUsagePath();
  try {
    if (existsSync(path)) {
      const record = JSON.parse(readFileSync(path, 'utf8')) as DuneUsageRecord;
      if (record.month === currentMonth()) return record;
    }
  } catch {
    // ignore — start fresh
  }
  return { month: currentMonth(), credits: 0 };
}

function saveDuneUsage(usage: DuneUsageRecord): void {
  try {
    const dir = getDataDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(getDuneUsagePath(), JSON.stringify(usage, null, 2), 'utf8');
  } catch (err) {
    console.error('[dune] Failed to save usage:', err);
  }
}

let _duneUsage: DuneUsageRecord = loadDuneUsage();

function addCredits(cost: number): boolean {
  if (_duneUsage.month !== currentMonth()) {
    _duneUsage = { month: currentMonth(), credits: 0 };
  }
  if (_duneUsage.credits + cost > MONTHLY_CREDIT_LIMIT) return false;
  _duneUsage.credits += cost;
  saveDuneUsage(_duneUsage);
  return true;
}

/**
 * Current Dune API credit usage.
 */
export function getDuneUsage(): { credits: number; monthlyLimit: number; remaining: number } {
  if (_duneUsage.month !== currentMonth()) {
    _duneUsage = { month: currentMonth(), credits: 0 };
  }
  return {
    credits: _duneUsage.credits,
    monthlyLimit: MONTHLY_CREDIT_LIMIT,
    remaining: Math.max(0, MONTHLY_CREDIT_LIMIT - _duneUsage.credits),
  };
}

// ---------------------------------------------------------------------------
// Dune API execution
// ---------------------------------------------------------------------------

interface DuneExecuteResponse {
  execution_id?: string;
  error?: string;
}

interface DuneStatusResponse {
  state?: string;            // QUERY_STATE_PENDING | QUERY_STATE_EXECUTING | QUERY_STATE_COMPLETED | QUERY_STATE_FAILED
  execution_id?: string;
  error?: string;
  result?: {
    rows?: Array<Record<string, unknown>>;
    metadata?: {
      column_names?: string[];
      result_set_bytes?: number;
    };
  };
}

export interface DuneQueryResult {
  templateName: string;
  title: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  executionTimeMs: number;
  creditsCost: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function duneRequest(path: string, method: string, body?: unknown): Promise<unknown> {
  const apiKey = process.env.DUNE_API_KEY;
  if (!apiKey) throw new Error('DUNE_API_KEY not set');

  const res = await fetch(`${DUNE_API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Dune-Api-Key': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dune API ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Execute a SQL query on Dune and poll for results.
 * Returns null if API key missing, credits exhausted, or execution fails.
 * Estimated credit cost: 10 per query (conservative estimate).
 */
export async function executeQuery(
  template: QueryTemplate,
  params: Record<string, string | number>,
): Promise<DuneQueryResult | null> {
  const apiKey = process.env.DUNE_API_KEY;
  if (!apiKey) return null;

  const estimatedCost = 10; // conservative per-query estimate
  if (!addCredits(estimatedCost)) {
    console.warn(`[dune] Monthly credit limit (${MONTHLY_CREDIT_LIMIT}) would be exceeded — skipping query`);
    return null;
  }

  const sql = fillTemplate(template, params);
  const startTime = Date.now();

  try {
    // Step 1: Execute the query
    const execResp = (await duneRequest('/query/execute', 'POST', {
      query_sql: sql,
      is_private: false,
    })) as DuneExecuteResponse;

    const executionId = execResp.execution_id;
    if (!executionId) {
      throw new Error(`No execution_id in response: ${JSON.stringify(execResp).slice(0, 200)}`);
    }

    // Step 2: Poll for completion
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const statusResp = (await duneRequest(
        `/execution/${executionId}/status`,
        'GET',
      )) as DuneStatusResponse;

      const state = statusResp.state ?? '';

      if (state === 'QUERY_STATE_COMPLETED') {
        // Step 3: Fetch results
        const resultResp = (await duneRequest(
          `/execution/${executionId}/results`,
          'GET',
        )) as DuneStatusResponse;

        const rows = resultResp.result?.rows ?? [];
        const columns = resultResp.result?.metadata?.column_names ?? (rows[0] ? Object.keys(rows[0]) : []);

        return {
          templateName: template.name,
          title: template.title,
          columns,
          rows,
          executionTimeMs: Date.now() - startTime,
          creditsCost: estimatedCost,
        };
      }

      if (state === 'QUERY_STATE_FAILED') {
        console.error(`[dune] Query failed: ${statusResp.error ?? 'unknown error'}`);
        return null;
      }

      // PENDING or EXECUTING — keep polling
    }

    console.error(`[dune] Query timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
    return null;
  } catch (err) {
    console.error(`[dune] executeQuery(${template.name}) error:`, err);
    return null;
  }
}

/**
 * Run all templates for a category with given params.
 * Returns results for templates that succeed; skips failures.
 */
export async function runTemplatesForCategory(
  category: string,
  params: Record<string, string | number>,
): Promise<DuneQueryResult[]> {
  const templates = getTemplatesForCategory(category);
  const results: DuneQueryResult[] = [];

  // Execute sequentially to control credit burn
  for (const template of templates) {
    const result = await executeQuery(template, params);
    if (result) results.push(result);
  }

  return results;
}
