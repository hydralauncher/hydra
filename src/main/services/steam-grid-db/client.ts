import axios, { AxiosError, AxiosInstance } from "axios";
import type { SgdbAsset, SgdbAssetType } from "@types";
import { logger } from "../logger";

interface SgdbResponse<T> {
  success: boolean;
  data: T;
  errors?: string[];
}

interface SgdbGame {
  id: number;
  name: string;
}

interface SgdbRawAsset {
  id: number;
  score?: number;
  url: string;
  thumb: string;
  width: number;
  height: number;
  style?: string;
}

const ASSET_ENDPOINT: Record<SgdbAssetType, string> = {
  grid: "grids",
  hero: "heroes",
  logo: "logos",
  icon: "icons",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SteamGridDbClient {
  private static instance: AxiosInstance | null = null;
  private static readonly baseURL = "https://www.steamgriddb.com/api/v2";
  private static readonly MAX_RETRIES = 3;

  static authorize(apiKey: string) {
    this.instance = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
  }

  static reset() {
    this.instance = null;
  }

  static isAuthorized() {
    return this.instance != null;
  }

  private static async request<T>(
    path: string,
    config?: { params?: Record<string, string> }
  ): Promise<T | null> {
    if (!this.instance) return null;

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await this.instance.get<SgdbResponse<T>>(path, config);
        if (response.data?.success) return response.data.data;
        return null;
      } catch (error) {
        const status = (error as AxiosError).response?.status;

        if (status === 404) return null;

        if (status === 429 && attempt < this.MAX_RETRIES) {
          await sleep(500 * 2 ** attempt);
          continue;
        }

        if ((!status || status >= 500) && attempt < this.MAX_RETRIES) {
          await sleep(300 * 2 ** attempt);
          continue;
        }

        logger.warn("SteamGridDB request failed", { path, status });
        return null;
      }
    }

    return null;
  }

  static async validate(): Promise<boolean> {
    if (!this.instance) return false;

    try {
      const response = await this.instance.get<SgdbResponse<SgdbGame>>(
        "/games/steam/570"
      );
      return response.status === 200 && response.data?.success === true;
    } catch {
      return false;
    }
  }

  static async getGameBySteamAppId(appId: string): Promise<number | null> {
    const game = await this.request<SgdbGame>(`/games/steam/${appId}`);
    return game?.id ?? null;
  }

  static async searchGameId(term: string): Promise<number | null> {
    if (!term) return null;
    const games = await this.request<SgdbGame[]>(
      `/search/autocomplete/${encodeURIComponent(term)}`
    );
    return games?.[0]?.id ?? null;
  }

  static async getAssets(
    type: SgdbAssetType,
    gameId: number
  ): Promise<SgdbAsset[]> {
    const params = type === "grid" ? { dimensions: "600x900" } : undefined;

    const assets = await this.request<SgdbRawAsset[]>(
      `/${ASSET_ENDPOINT[type]}/game/${gameId}`,
      params ? { params } : undefined
    );

    if (!assets) return [];

    return assets
      .map((asset) => ({
        id: asset.id,
        score: asset.score ?? 0,
        url: asset.url,
        thumb: asset.thumb,
        width: asset.width,
        height: asset.height,
        style: asset.style,
      }))
      .sort((a, b) => b.score - a.score);
  }
}
