// =============================================================================
// @binancebuddy/ai — Brave Search Client
// Provides web and news search via Brave Search API.
// - BRAVE_API_KEY from process.env (optional — returns [] if not set)
// - Monthly hard cap: 1500 calls. Counter persisted to data/brave-usage.json
// - Resets counter automatically when calendar month changes
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import type { BraveSearchResult } from '@binancebuddy/core';

const BRAVE_WEB_URL = 'https://api.search.brave.com/res/v1/web/search';
const BRAVE_NEWS_URL = 'https://api.search.brave.com/res/v1/news/search';
const MONTHLY_LIMIT = 1500;

// ---------------------------------------------------------------------------
// Usage counter — persisted to data/brave-usage.json
// ---------------------------------------------------------------------------

interface UsageRecord {
  month: string;  // "YYYY-MM"
  count: number;
}

function getDataDir(): string {
  return resolve(process.cwd(), 'data');
}

function getUsagePath(): string {
  return resolve(getDataDir(), 'brave-usage.json');
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function loadUsage(): UsageRecord {
  const path = getUsagePath();
  try {
    if (existsSync(path)) {
      const record = JSON.parse(readFileSync(path, 'utf8')) as UsageRecord;
      if (record.month === currentMonth()) return record;
    }
  } catch {
    // ignore — start fresh
  }
  return { month: currentMonth(), count: 0 };
}

function saveUsage(usage: UsageRecord): void {
  try {
    const dir = getDataDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(getUsagePath(), JSON.stringify(usage, null, 2), 'utf8');
  } catch (err) {
    console.error('[brave] Failed to save usage:', err);
  }
}

// In-memory cache of the usage record (loaded once per module import)
let _usage: UsageRecord = loadUsage();

function incrementUsage(): boolean {
  // Refresh month if needed
  if (_usage.month !== currentMonth()) {
    _usage = { month: currentMonth(), count: 0 };
  }
  if (_usage.count >= MONTHLY_LIMIT) return false;
  _usage.count++;
  saveUsage(_usage);
  return true;
}

// ---------------------------------------------------------------------------
// Brave API raw response types
// ---------------------------------------------------------------------------

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
}

interface BraveWebResponse {
  web?: { results?: BraveWebResult[] };
}

interface BraveNewsResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
}

interface BraveNewsResponse {
  results?: BraveNewsResult[];
}

// ---------------------------------------------------------------------------
// Internal search helper
// ---------------------------------------------------------------------------

async function braveSearch(
  endpoint: string,
  query: string,
  count: number,
): Promise<BraveSearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return [];

  if (!incrementUsage()) {
    console.warn(`[brave] Monthly cap (${MONTHLY_LIMIT}) reached — skipping search`);
    return [];
  }

  const url = `${endpoint}?q=${encodeURIComponent(query)}&count=${count}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!res.ok) {
      console.warn(`[brave] Search failed: ${res.status} ${res.statusText}`);
      return [];
    }

    // Web and news endpoints have different response shapes
    const json = (await res.json()) as BraveWebResponse & BraveNewsResponse;

    const raw: BraveWebResult[] =
      json.web?.results ?? json.results ?? [];

    return raw.map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: r.description ?? '',
      age: r.age,
    }));
  } catch (err) {
    console.error('[brave] Search error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Web search via Brave Search API.
 * Returns [] gracefully if key missing or monthly cap hit.
 */
export async function searchWeb(query: string, count = 5): Promise<BraveSearchResult[]> {
  return braveSearch(BRAVE_WEB_URL, query, Math.min(count, 10));
}

/**
 * News search via Brave Search API.
 * Returns [] gracefully if key missing or monthly cap hit.
 */
export async function searchNews(query: string, count = 5): Promise<BraveSearchResult[]> {
  return braveSearch(BRAVE_NEWS_URL, query, Math.min(count, 10));
}

/**
 * Current Brave API usage stats.
 */
export function getBraveUsage(): { count: number; monthlyLimit: number; remaining: number } {
  if (_usage.month !== currentMonth()) {
    _usage = { month: currentMonth(), count: 0 };
  }
  return {
    count: _usage.count,
    monthlyLimit: MONTHLY_LIMIT,
    remaining: Math.max(0, MONTHLY_LIMIT - _usage.count),
  };
}
