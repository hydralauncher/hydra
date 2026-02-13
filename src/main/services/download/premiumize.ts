import axios, { AxiosInstance } from "axios";
import parseTorrent from "parse-torrent";
import type { PremiumizeUser } from "@types";
import { logger } from "@main/services";

interface PremiumizeDirectDl {
  link: string;
}

interface PremiumizeResponse<T> {
  status: "success" | "error";
  message?: string;
  error?: string;
  response?: T;
  content?: T;
}

interface PremiumizeCacheCheckResponse {
  response?: boolean[];
}

export class PremiumizeClient {
  private static instance: AxiosInstance;
  private static apiToken: string;
  private static readonly baseURL = "https://www.premiumize.me/api";

  static authorize(apiToken: string) {
    this.apiToken = apiToken;
    this.instance = axios.create({
      baseURL: this.baseURL,
    });
  }

  private static getSearchParams(params?: Record<string, string>) {
    const searchParams = new URLSearchParams({
      apikey: this.apiToken,
      ...params,
    });

    return searchParams;
  }

  private static ensureSuccess<T>(payload: PremiumizeResponse<T>) {
    if (payload.status !== "success") {
      throw new Error(
        payload.message ?? payload.error ?? "Premiumize API error"
      );
    }
  }

  private static getMagnetInfoHash(uri: string) {
    try {
      const parsed = parseTorrent(uri);
      if (parsed.infoHash) return parsed.infoHash;
    } catch {
      // Fallback below handles raw xt values when parse-torrent cannot parse the URI.
    }

    const match = /xt=urn:btih:([a-z0-9]+)/i.exec(uri);
    const candidate = match?.[1];
    if (!candidate) return null;

    return candidate.toLowerCase();
  }

  static async getUser() {
    const response = await this.instance.get<
      PremiumizeResponse<PremiumizeUser>
    >("/account/info", {
      params: this.getSearchParams(),
    });

    this.ensureSuccess(response.data);

    return (
      response.data.response ?? {
        customer_id: "",
        premium_until: 0,
        space_used: 0,
        limit_used: 0,
      }
    );
  }

  private static async directDownload(uri: string) {
    const response = await this.instance.post<
      PremiumizeResponse<PremiumizeDirectDl[]>
    >(
      "/transfer/directdl",
      this.getSearchParams({
        src: uri,
      })
    );

    if (response.data.status !== "success") {
      return null;
    }

    return response.data.content ?? [];
  }

  static async getDownloadUrl(uri: string) {
    const links = await this.directDownload(uri);
    const [firstLink] = links ?? [];

    if (!firstLink?.link) return null;

    return decodeURIComponent(firstLink.link);
  }

  static async isCached(uri: string) {
    logger.log(`[Premiumize] Checking cache availability for URI: ${uri}`);

    let item = uri;
    if (uri.startsWith("magnet:")) {
      const infoHash = this.getMagnetInfoHash(uri);
      if (!infoHash) {
        logger.warn(
          `[Premiumize] Could not extract info hash from magnet URI while checking cache`
        );
        return false;
      }
      item = infoHash;
    }

    const response = await this.instance.get<
      PremiumizeResponse<PremiumizeCacheCheckResponse>
    >("/cache/check", {
      params: this.getSearchParams({
        "items[]": item,
      }),
    });

    this.ensureSuccess(response.data);
    const [isCached] = response.data.response?.response ?? [];

    const cached = Boolean(isCached);
    logger.log(
      `[Premiumize] Cache availability check result for URI: ${uri} => ${cached}`
    );

    return cached;
  }
}
