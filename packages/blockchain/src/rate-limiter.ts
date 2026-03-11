// =============================================================================
// @binancebuddy/blockchain — API Rate Limiter + Response Cache
//
// Tracks outbound API calls across Moralis, Ankr, and CoinGecko.
// Hard cap: 30,000/day (buffer below Moralis free tier of 40,000).
// Warn at 20,000. Cache responses 60s so repeated wallet scans are free.
// =============================================================================

const DAILY_CAP = 30_000;
const WARN_THRESHOLD = 20_000;
const CACHE_TTL_MS = 60_000; // 60 seconds

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

class RateLimiter {
  private callCount = 0;
  private resetAt: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor() {
    this.resetAt = RateLimiter.nextMidnight();
  }

  private static nextMidnight(): number {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  private tick(): void {
    if (Date.now() >= this.resetAt) {
      this.callCount = 0;
      this.resetAt = RateLimiter.nextMidnight();
    }
  }

  /**
   * Execute fn(), using the in-memory cache if a fresh entry exists.
   * Throws when the daily cap is reached.
   * @param cacheKey  Unique string identifying this request (e.g. "history:0xABC")
   * @param fn        Async function that makes the actual API call
   */
  async track<T>(cacheKey: string, fn: () => Promise<T>): Promise<T> {
    this.tick();

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T;
    }

    if (this.callCount >= DAILY_CAP) {
      throw new Error(
        `[rate-limiter] Daily API cap reached (${DAILY_CAP.toLocaleString()} calls). Resets at midnight UTC.`,
      );
    }

    if (this.callCount >= WARN_THRESHOLD && this.callCount % 100 === 0) {
      console.warn(
        `[rate-limiter] WARNING: ${this.callCount.toLocaleString()} API calls today — approaching cap of ${DAILY_CAP.toLocaleString()}.`,
      );
    }

    this.callCount++;
    const result = await fn();

    this.cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  /** Current call count (resets at midnight). */
  get count(): number {
    this.tick();
    return this.callCount;
  }

  /** Remaining calls today. */
  get remaining(): number {
    return Math.max(0, DAILY_CAP - this.count);
  }

  /** Unix ms when the counter resets. */
  get resetsAt(): number {
    return this.resetAt;
  }
}

export const rateLimiter = new RateLimiter();
