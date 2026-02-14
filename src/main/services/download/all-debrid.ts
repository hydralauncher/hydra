import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import parseTorrent from "parse-torrent";
import type { AllDebridUser } from "@types";
import { appVersion } from "@main/constants";
import { logger } from "@main/services";

interface AllDebridError {
  code: string;
  message: string;
}

interface AllDebridApiResponse<T> {
  status: "success" | "error";
  data: T;
  error?: AllDebridError;
}

interface AllDebridUserResponse {
  user: AllDebridUser;
}

interface AllDebridLinkUnlockResponse {
  link: string;
  filename?: string;
  filesize?: number;
  host?: string;
  hostDomain?: string;
  id?: string;
  delayed?: number;
  streams?: unknown[];
  paws?: boolean;
}

interface AllDebridDelayedResponse {
  status: number;
  time_left: number;
  link?: string;
}

interface AllDebridMagnet {
  id: number;
  hash: string;
  status: string;
  statusCode?: number;
  filename?: string;
  size?: number;
}

type AllDebridMagnetsPayload =
  | AllDebridMagnet[]
  | AllDebridMagnet
  | Record<string, AllDebridMagnet>;

interface AllDebridMagnetUploadResponse {
  magnets: AllDebridMagnetsPayload;
}

interface AllDebridMagnetStatusResponse {
  magnets: AllDebridMagnetsPayload;
}

interface AllDebridMagnetFileNode {
  n?: string;
  l?: string;
  s?: number;
  e?: AllDebridMagnetFileNode[];
}

interface AllDebridMagnetFilesItem {
  id: number | string;
  files?: AllDebridMagnetFileNode[];
  error?: AllDebridError;
}

type AllDebridMagnetFilesPayload =
  | AllDebridMagnetFilesItem[]
  | AllDebridMagnetFilesItem
  | Record<string, AllDebridMagnetFilesItem>;

interface AllDebridMagnetFilesResponse {
  magnets: AllDebridMagnetFilesPayload;
}

interface AllDebridFileEntry {
  link: string;
  relativePath: string;
  size?: number;
}

interface AllDebridDownloadInfo {
  url: string;
  filename?: string;
}

interface AllDebridDownloadEntry {
  url: string;
  filename: string;
  size?: number;
  isLocked?: boolean;
}

export class AllDebridClient {
  private static instance: AxiosInstance;
  private static apiToken: string;
  private static readonly baseURL = "https://api.alldebrid.com/v4";
  private static readonly agent = `Hydra/${appVersion}`;

  private static readonly RL_PER_SECOND = 10;
  private static readonly RL_PER_MINUTE = 500;
  private static readonly RL_RETRY_MAX = 5;
  private static readonly RL_RETRY_BASE_MS = 2000;
  private static requestTimestamps: number[] = [];
  private static throttleChain: Promise<void> = Promise.resolve();

  private static throttle(): Promise<void> {
    this.throttleChain = this.throttleChain.then(() => this.applyThrottle());
    return this.throttleChain;
  }

  private static async applyThrottle(): Promise<void> {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => now - ts < 60_000
    );

    const oneSecAgo = now - 1_000;
    const inLastSecond = this.requestTimestamps.filter(
      (ts) => ts >= oneSecAgo
    ).length;

    if (inLastSecond >= this.RL_PER_SECOND) {
      const oldest = this.requestTimestamps.find((ts) => ts >= oneSecAgo)!;
      const waitMs = oldest + 1_000 - now + 50;
      await new Promise((r) => setTimeout(r, waitMs));
    }

    if (this.requestTimestamps.length >= this.RL_PER_MINUTE) {
      const waitMs = this.requestTimestamps[0] + 60_000 - Date.now() + 50;
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    this.requestTimestamps.push(Date.now());
  }

  static authorize(apiToken: string) {
    this.apiToken = apiToken;
    this.instance = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    });

    this.instance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        await this.throttle();
        return config;
      }
    );

    this.instance.interceptors.response.use(undefined, async (error) => {
      const status = error?.response?.status;
      if (status !== 429 && status !== 503) throw error;

      const config = error.config;
      if (!config) throw error;

      const retryCount: number =
        ((config as Record<string, unknown>).__rlRetry as number) ?? 0;
      if (retryCount >= this.RL_RETRY_MAX) {
        logger.error(
          `[AllDebrid] Rate-limit retries exhausted (${this.RL_RETRY_MAX})`
        );
        throw error;
      }

      (config as Record<string, unknown>).__rlRetry = retryCount + 1;
      const delay = this.RL_RETRY_BASE_MS * Math.pow(2, retryCount);
      logger.warn(
        `[AllDebrid] ${status} rate-limited, retry ${retryCount + 1}/${this.RL_RETRY_MAX} in ${delay}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
      return this.instance.request(config);
    });
  }

  private static getSearchParams(params?: Record<string, string>) {
    return new URLSearchParams({
      apikey: this.apiToken,
      agent: this.agent,
      ...params,
    });
  }

  private static ensureSuccess<T>(payload: AllDebridApiResponse<T>) {
    if (payload.status === "error") {
      throw new Error(payload.error?.message ?? "AllDebrid API error");
    }
  }

  private static getMagnetInfoHash(uri: string) {
    try {
      const parsed = parseTorrent(uri);
      if (parsed.infoHash) return parsed.infoHash.toLowerCase();
    } catch {
      // parse-torrent may throw for malformed URIs
    }

    const regex = /xt=urn:btih:([a-z0-9]+)/i;
    const directMatch = regex.exec(uri);
    if (directMatch?.[1]) return directMatch[1].toLowerCase();

    try {
      const decodedMatch = regex.exec(decodeURIComponent(uri));
      if (decodedMatch?.[1]) return decodedMatch[1].toLowerCase();
    } catch {
      // decodeURIComponent may throw for malformed URIs
    }

    return null;
  }

  private static normalizeMagnets(
    magnets: AllDebridMagnetsPayload
  ): AllDebridMagnet[] {
    if (Array.isArray(magnets)) return magnets;
    if (!magnets || typeof magnets !== "object") return [];
    if ("id" in magnets && "hash" in magnets) {
      return [magnets as AllDebridMagnet];
    }
    return Object.values(magnets);
  }

  private static normalizeMagnetFiles(
    magnets: AllDebridMagnetFilesPayload
  ): AllDebridMagnetFilesItem[] {
    if (Array.isArray(magnets)) return magnets;
    if (!magnets || typeof magnets !== "object") return [];
    if ("id" in magnets) return [magnets as AllDebridMagnetFilesItem];
    return Object.values(magnets);
  }

  private static extractFilenameFromLink(link: string) {
    try {
      const parsed = new URL(link);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const last = parts.at(-1);
      return last || "file";
    } catch {
      return "file";
    }
  }

  private static extractFileEntries(
    files: AllDebridMagnetFileNode[],
    parentPath: string[] = []
  ): AllDebridFileEntry[] {
    const entries: AllDebridFileEntry[] = [];

    for (const node of files) {
      if (node.l) {
        const fileName = node.n || this.extractFilenameFromLink(node.l);
        entries.push({
          link: node.l,
          relativePath: [...parentPath, fileName].join("/"),
          size: typeof node.s === "number" ? node.s : undefined,
        });
      }

      if (node.e?.length) {
        const nextParentPath = node.n ? [...parentPath, node.n] : parentPath;
        entries.push(...this.extractFileEntries(node.e, nextParentPath));
      }
    }

    return entries;
  }

  static async getUser() {
    const response = await this.instance.get<
      AllDebridApiResponse<AllDebridUserResponse>
    >(`/user?${this.getSearchParams().toString()}`);
    this.ensureSuccess(response.data);
    return response.data.data.user;
  }

  private static async unlockLink(link: string) {
    const response = await this.instance.post<
      AllDebridApiResponse<AllDebridLinkUnlockResponse>
    >(
      `/link/unlock?${this.getSearchParams().toString()}`,
      new URLSearchParams({ link })
    );
    this.ensureSuccess(response.data);

    const { link: downloadLink, delayed } = response.data.data;

    if (delayed) {
      const resolvedLink = await this.waitForDelayedLink(delayed);
      return {
        ...response.data.data,
        link: resolvedLink,
      };
    }

    if (!downloadLink) {
      throw new Error(
        "[AllDebrid] /link/unlock returned neither a download link nor a delayed ID"
      );
    }

    return response.data.data;
  }

  private static readonly DELAYED_POLL_INTERVAL_MS = 5000;
  private static readonly DELAYED_MAX_ATTEMPTS = 120;

  private static async waitForDelayedLink(delayedId: number): Promise<string> {
    for (let attempt = 1; attempt <= this.DELAYED_MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.DELAYED_POLL_INTERVAL_MS)
      );

      const response = await this.instance.post<
        AllDebridApiResponse<AllDebridDelayedResponse>
      >(
        `/link/delayed?${this.getSearchParams().toString()}`,
        new URLSearchParams({ id: delayedId.toString() })
      );
      this.ensureSuccess(response.data);

      const { status, link } = response.data.data;

      if (status === 2 && link) {
        return link;
      }

      if (status === 3) {
        throw new Error(
          "[AllDebrid] Delayed link generation failed (status=3)"
        );
      }
    }

    throw new Error(
      `[AllDebrid] Delayed link timed out after ${this.DELAYED_MAX_ATTEMPTS} attempts`
    );
  }

  private static async getMagnetStatus(id?: number) {
    const payload = new URLSearchParams({
      agent: this.agent,
      ...(id ? { id: id.toString() } : {}),
    });

    const response = await this.instance.post<
      AllDebridApiResponse<AllDebridMagnetStatusResponse>
    >("https://api.alldebrid.com/v4.1/magnet/status", payload);
    this.ensureSuccess(response.data);
    return this.normalizeMagnets(response.data.data.magnets);
  }

  private static async getMagnetFiles(id: number) {
    const payload = new URLSearchParams({
      agent: this.agent,
    });
    payload.append("id[]", id.toString());

    const requestMagnetFiles = async (endpoint: string) => {
      const response = await this.instance.post<
        AllDebridApiResponse<AllDebridMagnetFilesResponse>
      >(endpoint, payload);
      this.ensureSuccess(response.data);

      const magnets = this.normalizeMagnetFiles(response.data.data.magnets);
      const [firstMagnet] = magnets;

      if (firstMagnet?.error) {
        logger.warn(
          `[AllDebrid] ${endpoint} returned per-magnet error code=${firstMagnet.error.code} message=${firstMagnet.error.message}`
        );
        return [];
      }

      return this.extractFileEntries(firstMagnet?.files ?? []);
    };

    try {
      return await requestMagnetFiles(
        "https://api.alldebrid.com/v4.1/magnet/files"
      );
    } catch (error) {
      logger.warn(
        `[AllDebrid] /v4.1/magnet/files failed, falling back to /v4/magnet/files`,
        error
      );
      return requestMagnetFiles("https://api.alldebrid.com/v4/magnet/files");
    }
  }

  private static async addMagnet(magnet: string) {
    const payload = new URLSearchParams({
      agent: this.agent,
    });
    payload.append("magnets[]", magnet);

    const response = await this.instance.post<
      AllDebridApiResponse<AllDebridMagnetUploadResponse>
    >(`/magnet/upload?${this.getSearchParams().toString()}`, payload);
    this.ensureSuccess(response.data);
    return this.normalizeMagnets(response.data.data.magnets);
  }

  private static async getMagnetId(magnetUri: string) {
    const infoHash = this.getMagnetInfoHash(magnetUri);
    if (!infoHash) {
      logger.warn(`[AllDebrid] Could not extract info hash for magnet`);
      return null;
    }

    const userMagnets = await this.getMagnetStatus();
    const existingMagnet = userMagnets.find(
      (magnet) => magnet.hash.toLowerCase() === infoHash
    );

    if (existingMagnet) return existingMagnet.id;

    const uploadedMagnets = await this.addMagnet(magnetUri);
    return uploadedMagnets[0]?.id ?? null;
  }

  static async getDownloadEntries(
    uri: string
  ): Promise<AllDebridDownloadEntry[] | null> {
    if (!uri.startsWith("magnet:")) {
      const unlockData = await this.unlockLink(uri);
      const decoded = decodeURIComponent(unlockData.link);
      const filename =
        unlockData.filename || this.extractFilenameFromLink(decoded);

      return [
        {
          url: decoded,
          filename,
          size: unlockData.filesize,
          isLocked: false,
        },
      ];
    }

    const magnetId = await this.getMagnetId(uri);
    if (!magnetId) {
      logger.warn(`[AllDebrid] Magnet id resolution failed`);
      return null;
    }

    const magnets = await this.getMagnetStatus(magnetId);
    const [magnetStatus] = magnets;
    const statusCode = magnetStatus?.statusCode;

    if (statusCode !== undefined && statusCode >= 5) {
      logger.error(
        `[AllDebrid] Magnet id=${magnetId} is in error state: ${magnetStatus?.status} (code=${statusCode})`
      );
      return null;
    }

    if (statusCode !== undefined && statusCode !== 4) {
      logger.warn(
        `[AllDebrid] Magnet id=${magnetId} is not ready yet: ${magnetStatus?.status} (code=${statusCode}). Torrent is still processing on AllDebrid servers.`
      );
      return null;
    }

    const links = await this.getMagnetFiles(magnetId);
    if (links.length === 0) {
      logger.warn(
        `[AllDebrid] No downloadable links for magnet id=${magnetId}`
      );
      return null;
    }

    return links.map((file) => ({
      url: file.link,
      filename: file.relativePath,
      size: file.size,
      isLocked: true,
    }));
  }

  static async unlockDownloadLink(link: string) {
    const unlockData = await this.unlockLink(link);
    return decodeURIComponent(unlockData.link);
  }

  static async getDownloadInfo(
    uri: string
  ): Promise<AllDebridDownloadInfo | null> {
    const entries = await this.getDownloadEntries(uri);
    const [firstEntry] = entries ?? [];
    if (!firstEntry) return null;

    const resolvedUrl = firstEntry.isLocked
      ? await this.unlockDownloadLink(firstEntry.url)
      : firstEntry.url;

    return { url: resolvedUrl, filename: firstEntry.filename };
  }

  static async getDownloadUrl(uri: string) {
    const info = await this.getDownloadInfo(uri);
    return info?.url ?? null;
  }

  static async isCached(uri: string) {
    if (!uri.startsWith("magnet:")) return true;

    const infoHash = this.getMagnetInfoHash(uri);
    if (!infoHash) {
      logger.warn(`[AllDebrid] Could not extract info hash for cache check`);
      return false;
    }

    const userMagnets = await this.getMagnetStatus();
    const existing = userMagnets.find((m) => m.hash.toLowerCase() === infoHash);
    return existing?.statusCode === 4;
  }
}
