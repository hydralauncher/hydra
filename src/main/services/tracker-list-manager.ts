import { logger } from "./logger";

export class TrackerListManager {
  private static cache: Map<string, string[]> = new Map();
  private static cacheTimestamp: Map<string, number> = new Map();
  private static readonly CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

  static async fetchTrackerList(url: string): Promise<string[]> {
    if (!url || typeof url !== "string") {
      return [];
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return [];
    }

    // Check cache
    const cachedTrackers = this.cache.get(trimmedUrl);
    const cachedTime = this.cacheTimestamp.get(trimmedUrl);
    if (
      cachedTrackers &&
      cachedTime &&
      Date.now() - cachedTime < this.CACHE_DURATION_MS
    ) {
      logger.log(
        `[TrackerListManager] Using cached trackers for ${trimmedUrl}`
      );
      return cachedTrackers;
    }

    try {
      logger.log(
        `[TrackerListManager] Fetching tracker list from ${trimmedUrl}`
      );

      const response = await fetch(trimmedUrl, {
        signal: AbortSignal.timeout(10000), // 10 seconds timeout
      });

      if (!response.ok) {
        logger.warn(
          `[TrackerListManager] Failed to fetch tracker list: ${response.status} ${response.statusText}`
        );
        return [];
      }

      const text = await response.text();
      const trackers = this.parseTrackerList(text);

      // Cache the result
      this.cache.set(trimmedUrl, trackers);
      this.cacheTimestamp.set(trimmedUrl, Date.now());

      logger.log(
        `[TrackerListManager] Successfully fetched ${trackers.length} trackers from ${trimmedUrl}`
      );

      return trackers;
    } catch (error) {
      logger.error(`[TrackerListManager] Error fetching tracker list:`, error);
      return [];
    }
  }

  private static parseTrackerList(content: string): string[] {
    const trackers: string[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      // Validate it looks like a tracker URL
      if (
        (trimmed.startsWith("http://") ||
          trimmed.startsWith("https://") ||
          trimmed.startsWith("udp://")) &&
        trimmed.includes("announce")
      ) {
        trackers.push(trimmed);
      }
    }

    return trackers;
  }

  static clearCache(): void {
    this.cache.clear();
    this.cacheTimestamp.clear();
    logger.log("[TrackerListManager] Cache cleared");
  }

  static clearCacheForUrl(url: string): void {
    this.cache.delete(url);
    this.cacheTimestamp.delete(url);
    logger.log(`[TrackerListManager] Cache cleared for ${url}`);
  }
}
