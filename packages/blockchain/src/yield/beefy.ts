// =============================================================================
// Beefy Finance — Vault API Client
// Fetches BSC vaults from Beefy's public API, cached 1 hour.
// =============================================================================

export interface BeefyVault {
  id: string;
  name: string;
  chain: string;
  token: string;
  tokenAddress: string;         // want token (LP or single asset)
  earnContractAddress: string;  // vault contract to deposit into
  status: 'active' | 'eol';
  platformId: string;
  assets: string[];
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const BEEFY_VAULTS_URL = 'https://api.beefy.finance/vaults';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedVaults: BeefyVault[] = [];
let cacheTimestamp = 0;

// ---------------------------------------------------------------------------
// Fetch + filter
// ---------------------------------------------------------------------------

async function fetchBscVaults(): Promise<BeefyVault[]> {
  if (cachedVaults.length > 0 && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedVaults;
  }

  const res = await fetch(BEEFY_VAULTS_URL);
  if (!res.ok) {
    throw new Error(`Beefy API error: ${res.status} ${res.statusText}`);
  }

  const all = (await res.json()) as BeefyVault[];
  cachedVaults = all.filter(
    (v) => v.chain === 'bsc' && v.status === 'active',
  );
  cacheTimestamp = Date.now();
  return cachedVaults;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find a Beefy vault whose assets contain the given token symbol.
 * Matches case-insensitively against the `assets` array and `token` field.
 */
export async function findVaultForToken(
  symbol: string,
): Promise<BeefyVault | null> {
  const vaults = await fetchBscVaults();
  const upper = symbol.toUpperCase();

  return (
    vaults.find(
      (v) =>
        v.assets.some((a) => a.toUpperCase() === upper) ||
        v.token.toUpperCase() === upper,
    ) ?? null
  );
}

/**
 * Find a Beefy vault matching a specific platform (e.g. 'pancakeswap')
 * and token symbol. More precise than findVaultForToken.
 */
export async function findVaultByPlatform(
  platform: string,
  symbol: string,
): Promise<BeefyVault | null> {
  const vaults = await fetchBscVaults();
  const upperSymbol = symbol.toUpperCase();
  const lowerPlatform = platform.toLowerCase();

  return (
    vaults.find(
      (v) =>
        v.platformId.toLowerCase().includes(lowerPlatform) &&
        (v.assets.some((a) => a.toUpperCase() === upperSymbol) ||
          v.token.toUpperCase() === upperSymbol),
    ) ?? null
  );
}
