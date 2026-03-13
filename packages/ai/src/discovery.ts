// =============================================================================
// @binancebuddy/ai — Protocol Discovery Agent
// Discovers new BSC DeFi protocols from DeFiLlama and Brave Search.
//
// Noise filtering (Fix #4):
//   Brave-found protocols are only added as verified=true if they ALSO
//   appear on DeFiLlama. Otherwise they're stored as verified=false and
//   will NOT be auto-researched.
//
// Registry persisted to: data/protocol-registry.json
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { ProtocolEntry, DiscoveryResult, ProtocolCategory } from '@binancebuddy/core';
import {
  fetchAllProtocols,
  categorizeProtocol,
  isKnownProtocol,
} from './data/defillama.js';
import { searchWeb } from './data/brave-search.js';

// ---------------------------------------------------------------------------
// Registry persistence
// ---------------------------------------------------------------------------

function getDataDir(): string {
  return resolve(process.cwd(), 'data');
}

function getRegistryPath(): string {
  return resolve(getDataDir(), 'protocol-registry.json');
}

// In-memory registry (slug → ProtocolEntry)
let registry = new Map<string, ProtocolEntry>();
let lastRunAt: number | null = null;

/**
 * Load registry from disk into memory.
 * Called once at module init and on demand.
 */
export function loadRegistry(): void {
  const path = getRegistryPath();
  try {
    if (existsSync(path)) {
      const entries = JSON.parse(readFileSync(path, 'utf8')) as ProtocolEntry[];
      registry = new Map(entries.map((e) => [e.slug, e]));
    }
  } catch (err) {
    console.error('[discovery] Failed to load registry:', err);
    registry = new Map();
  }
}

function saveRegistry(): void {
  try {
    const dir = getDataDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const entries = Array.from(registry.values());
    writeFileSync(getRegistryPath(), JSON.stringify(entries, null, 2), 'utf8');
  } catch (err) {
    console.error('[discovery] Failed to save registry:', err);
  }
}

// Load on module import
loadRegistry();

// ---------------------------------------------------------------------------
// DeFiLlama discovery
// ---------------------------------------------------------------------------

async function discoverFromDeFiLlama(): Promise<ProtocolEntry[]> {
  const protocols = await fetchAllProtocols();
  const newEntries: ProtocolEntry[] = [];

  for (const protocol of protocols) {
    if (!registry.has(protocol.slug)) {
      const entry: ProtocolEntry = { ...protocol, verified: true };
      registry.set(protocol.slug, entry);
      newEntries.push(entry);
    } else {
      // Update TVL/volume for existing entry
      const existing = registry.get(protocol.slug)!;
      registry.set(protocol.slug, {
        ...existing,
        tvlUsd: protocol.tvlUsd,
        volume24h: protocol.volume24h,
      });
    }
  }

  return newEntries;
}

// ---------------------------------------------------------------------------
// Brave discovery — with noise filtering
// ---------------------------------------------------------------------------

/**
 * Extract a plausible protocol slug from a Brave search result.
 * Very conservative — only extract if we find a clear protocol name.
 */
function extractSlugFromResult(result: { title: string; url: string; description: string }): string | null {
  // Try to extract from URL: e.g. "pancakeswap.finance" → "pancakeswap"
  try {
    const url = new URL(result.url);
    const host = url.hostname.replace(/^www\./, '');
    const parts = host.split('.');
    if (parts.length >= 2) {
      const candidate = parts[0];
      // Skip very generic or short names
      if (candidate.length > 3 && !/^(app|docs|gov|blog|info)$/.test(candidate)) {
        return candidate.toLowerCase();
      }
    }
  } catch {
    // ignore invalid URLs
  }
  return null;
}

async function discoverFromBrave(): Promise<ProtocolEntry[]> {
  const queries = [
    'new DeFi protocol BSC BNB Chain 2026 launch',
    'new yield farming protocol Binance Smart Chain',
  ];

  const allResults: Array<{ title: string; url: string; description: string }> = [];

  for (const query of queries) {
    const results = await searchWeb(query, 5);
    allResults.push(...results);
  }

  const newEntries: ProtocolEntry[] = [];

  for (const result of allResults) {
    const slug = extractSlugFromResult(result);
    if (!slug || registry.has(slug)) continue;

    // Verify: check if this slug is on DeFiLlama
    const onDeFiLlama = await isKnownProtocol(slug);

    const entry: ProtocolEntry = {
      name: result.title.split(' ')[0] ?? slug,
      slug,
      category: 'other' as ProtocolCategory,
      chain: 'bsc',
      tvlUsd: 0,
      volume24h: 0,
      website: result.url,
      contractAddresses: [],
      discoveredAt: Date.now(),
      source: 'brave',
      // Only verified=true if also on DeFiLlama
      verified: onDeFiLlama,
      lastResearched: null,
    };

    // If it IS on DeFiLlama, get the full entry data
    if (onDeFiLlama) {
      const protocols = await fetchAllProtocols();
      const defiLlamaEntry = protocols.find((p) => p.slug === slug);
      if (defiLlamaEntry) {
        registry.set(slug, { ...defiLlamaEntry, source: 'brave', verified: true });
        newEntries.push(registry.get(slug)!);
        continue;
      }
    }

    // Not on DeFiLlama — add as unverified (won't be auto-researched)
    registry.set(slug, entry);
    newEntries.push(entry);
  }

  return newEntries;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a full discovery scan.
 * 1. DeFiLlama: add/update all BSC protocols
 * 2. Brave: find new launches, verify against DeFiLlama
 * Returns only newly added protocols.
 */
export async function discoverNewProtocols(): Promise<DiscoveryResult> {
  const totalBefore = registry.size;

  const [defiLlamaNew, braveNew] = await Promise.all([
    discoverFromDeFiLlama(),
    discoverFromBrave(),
  ]);

  // Deduplicate (Brave may find something DeFiLlama already found in same run)
  const slugsSeen = new Set<string>();
  const newProtocols: ProtocolEntry[] = [];
  for (const p of [...defiLlamaNew, ...braveNew]) {
    if (!slugsSeen.has(p.slug)) {
      slugsSeen.add(p.slug);
      newProtocols.push(p);
    }
  }

  saveRegistry();
  lastRunAt = Date.now();

  console.log(
    `[discovery] Scan complete. ${newProtocols.length} new protocols. Registry: ${registry.size} total.`,
  );

  return {
    newProtocols,
    totalScanned: registry.size - totalBefore + newProtocols.length,
    lastRunAt,
  };
}

/**
 * Return the full in-memory registry as an array.
 */
export function getRegistry(): ProtocolEntry[] {
  return Array.from(registry.values());
}

/**
 * Find a single entry by DeFiLlama slug.
 */
export function getRegistryEntry(slug: string): ProtocolEntry | null {
  return registry.get(slug) ?? null;
}

/**
 * Unix timestamp of last discovery run, or null if never run.
 */
export function getLastDiscoveryRun(): number | null {
  return lastRunAt;
}
