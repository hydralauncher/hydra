import { app } from "electron";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

interface CachedResource<T = unknown> {
  data: T;
  etag: string | null;
}

export class ResourceCache {
  private static cacheDir: string;

  static initialize() {
    this.cacheDir = path.join(app.getPath("userData"), "resource-cache");

    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private static getCacheFilePath(resourceName: string): string {
    return path.join(this.cacheDir, `${resourceName}.json`);
  }

  private static getEtagFilePath(resourceName: string): string {
    return path.join(this.cacheDir, `${resourceName}.etag`);
  }

  private static readCachedResource<T = unknown>(
    resourceName: string
  ): CachedResource<T> | null {
    const dataPath = this.getCacheFilePath(resourceName);
    const etagPath = this.getEtagFilePath(resourceName);

    if (!fs.existsSync(dataPath)) {
      return null;
    }

    try {
      const data = JSON.parse(fs.readFileSync(dataPath, "utf-8")) as T;
      const etag = fs.existsSync(etagPath)
        ? fs.readFileSync(etagPath, "utf-8")
        : null;

      return { data, etag };
    } catch (error) {
      logger.error(`Failed to read cached resource ${resourceName}:`, error);
      return null;
    }
  }

  private static writeCachedResource<T = unknown>(
    resourceName: string,
    data: T,
    etag: string | null
  ): void {
    const dataPath = this.getCacheFilePath(resourceName);
    const etagPath = this.getEtagFilePath(resourceName);

    try {
      fs.writeFileSync(dataPath, JSON.stringify(data), "utf-8");

      if (etag) {
        fs.writeFileSync(etagPath, etag, "utf-8");
      }

      logger.info(
        `Cached resource ${resourceName} with etag: ${etag || "none"}`
      );
    } catch (error) {
      logger.error(`Failed to write cached resource ${resourceName}:`, error);
    }
  }

  static async fetchAndCache<T = unknown>(
    resourceName: string,
    url: string,
    timeout: number = 10000
  ): Promise<T> {
    const cached = this.readCachedResource<T>(resourceName);
    const headers: Record<string, string> = {};

    if (cached?.etag) {
      headers["If-None-Match"] = cached.etag;
    }

    try {
      const response = await axios.get<T>(url, {
        headers,
        timeout,
      });

      const newEtag = response.headers["etag"] || null;
      this.writeCachedResource(resourceName, response.data, newEtag);

      return response.data;
    } catch (error: unknown) {
      const axiosError = error as {
        response?: { status?: number };
        message?: string;
      };

      if (axiosError.response?.status === 304 && cached) {
        logger.info(`Resource ${resourceName} not modified, using cache`);
        return cached.data;
      }

      if (cached) {
        logger.warn(
          `Failed to fetch ${resourceName}, using cached version:`,
          axiosError.message || "Unknown error"
        );
        return cached.data;
      }

      logger.error(
        `Failed to fetch ${resourceName} and no cache available:`,
        error
      );
      throw error;
    }
  }

  static getCachedData<T = unknown>(resourceName: string): T | null {
    const cached = this.readCachedResource<T>(resourceName);
    return cached?.data || null;
  }

  static async updateResourcesOnStartup(): Promise<void> {
    logger.info("Starting background resource cache update...");

    const resources = [
      {
        name: "steam-games-by-letter",
        url: `${process.env.MAIN_VITE_EXTERNAL_RESOURCES_URL}/steam-games-by-letter.json`,
      },
      {
        name: "sources-manifest",
        url: "https://cdn.losbroxas.org/sources-manifest.json",
      },
    ];

    await Promise.allSettled(
      resources.map(async (resource) => {
        try {
          await this.fetchAndCache(resource.name, resource.url);
        } catch (error) {
          logger.error(`Failed to update ${resource.name} on startup:`, error);
        }
      })
    );

    logger.info("Resource cache update complete");
  }
}
