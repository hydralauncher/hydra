import axios, { AxiosInstance } from "axios";
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

  static authorize(apiToken: string) {
    this.apiToken = apiToken;
    this.instance = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
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

  private static shorten(value: string, max = 120) {
    if (value.length <= max) return value;
    return `${value.slice(0, max)}...`;
  }

  private static getMagnetInfoHash(uri: string) {
    try {
      const parsed = parseTorrent(uri);
      if (parsed.infoHash) return parsed.infoHash.toLowerCase();
    } catch {
      // Fallback below extracts btih directly from the magnet URI.
    }

    const regex = /xt=urn:btih:([a-z0-9]+)/i;
    const directMatch = regex.exec(uri);
    if (directMatch?.[1]) return directMatch[1].toLowerCase();

    try {
      const decodedMatch = regex.exec(decodeURIComponent(uri));
      if (decodedMatch?.[1]) return decodedMatch[1].toLowerCase();
    } catch {
      // Ignore malformed URI encoding and fail gracefully below.
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
    logger.log(
      `[AllDebrid] Requesting POST /link/unlock with link=${this.shorten(link)}`
    );

    const response = await this.instance.post<
      AllDebridApiResponse<AllDebridLinkUnlockResponse>
    >(
      `/link/unlock?${this.getSearchParams().toString()}`,
      new URLSearchParams({ link })
    );
    this.ensureSuccess(response.data);

    const {
      link: downloadLink,
      filename,
      filesize,
      host,
      delayed,
    } = response.data.data;

    logger.log(
      `[AllDebrid] /link/unlock response status=${response.data.status} hasLink=${Boolean(downloadLink)} filename=${filename ?? "unknown"} filesize=${filesize ?? "unknown"} host=${host ?? "unknown"} delayed=${delayed ?? "none"}`
    );

    // Handle delayed links: poll /link/delayed until the download link is ready
    if (delayed) {
      logger.log(
        `[AllDebrid] Link is delayed (id=${delayed}), polling /link/delayed...`
      );
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
  private static readonly DELAYED_MAX_ATTEMPTS = 120; // 10 minutes max

  private static async waitForDelayedLink(delayedId: number): Promise<string> {
    for (let attempt = 1; attempt <= this.DELAYED_MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.DELAYED_POLL_INTERVAL_MS)
      );

      logger.log(
        `[AllDebrid] Polling /link/delayed id=${delayedId} attempt=${attempt}/${this.DELAYED_MAX_ATTEMPTS}`
      );

      const response = await this.instance.post<
        AllDebridApiResponse<AllDebridDelayedResponse>
      >(
        `/link/delayed?${this.getSearchParams().toString()}`,
        new URLSearchParams({ id: delayedId.toString() })
      );
      this.ensureSuccess(response.data);

      const { status, time_left, link } = response.data.data;
      logger.log(
        `[AllDebrid] /link/delayed response status=${status} time_left=${time_left} hasLink=${Boolean(link)}`
      );

      if (status === 2 && link) {
        logger.log(`[AllDebrid] Delayed link ready: ${this.shorten(link)}`);
        return link;
      }

      if (status === 3) {
        throw new Error(
          "[AllDebrid] Delayed link generation failed (status=3)"
        );
      }

      // status === 1 means still processing, continue polling
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

    logger.log(
      `[AllDebrid] Requesting /v4.1/magnet/status with id=${id ?? "all"}`
    );
    const response = await this.instance.post<
      AllDebridApiResponse<AllDebridMagnetStatusResponse>
    >("https://api.alldebrid.com/v4.1/magnet/status", payload);
    this.ensureSuccess(response.data);
    const magnets = this.normalizeMagnets(response.data.data.magnets);
    logger.log(
      `[AllDebrid] /v4.1/magnet/status response status=${response.data.status} magnets=${magnets.length}`
    );
    return magnets;
  }

  private static async getMagnetFiles(id: number) {
    const payload = new URLSearchParams({
      agent: this.agent,
    });
    payload.append("id[]", id.toString());

    const requestMagnetFiles = async (endpoint: string) => {
      logger.log(`[AllDebrid] Requesting ${endpoint} with id[]=${id}`);
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

      const links = this.extractFileEntries(firstMagnet?.files ?? []);
      logger.log(
        `[AllDebrid] ${endpoint} response status=${response.data.status} links=${links.length}`
      );
      return links;
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
    logger.log(
      `[AllDebrid] Requesting POST /magnet/upload with magnet=${this.shorten(magnet)}`
    );

    const payload = new URLSearchParams({
      agent: this.agent,
    });
    payload.append("magnets[]", magnet);

    const response = await this.instance.post<
      AllDebridApiResponse<AllDebridMagnetUploadResponse>
    >(`/magnet/upload?${this.getSearchParams().toString()}`, payload);
    this.ensureSuccess(response.data);
    const magnets = this.normalizeMagnets(response.data.data.magnets);
    logger.log(
      `[AllDebrid] /magnet/upload response status=${response.data.status} magnets=${magnets.length}`
    );
    return magnets;
  }

  private static async getMagnetId(magnetUri: string) {
    logger.log(
      `[AllDebrid] Resolving magnet id for magnet=${this.shorten(magnetUri)}`
    );
    const infoHash = this.getMagnetInfoHash(magnetUri);
    if (!infoHash) {
      logger.warn(
        `[AllDebrid] Could not extract info hash while resolving magnet id`
      );
      return null;
    }

    const hash = infoHash;

    const userMagnets = await this.getMagnetStatus();
    const existingMagnet = userMagnets.find(
      (magnet) => magnet.hash.toLowerCase() === hash
    );

    if (existingMagnet) {
      logger.log(
        `[AllDebrid] Reusing existing magnet id=${existingMagnet.id} for hash=${hash}`
      );
      return existingMagnet.id;
    }

    const uploadedMagnets = await this.addMagnet(magnetUri);
    const [firstMagnet] = uploadedMagnets;

    logger.log(
      `[AllDebrid] Uploaded magnet, received id=${firstMagnet?.id ?? "null"}`
    );
    return firstMagnet?.id ?? null;
  }

  static async getDownloadEntries(
    uri: string
  ): Promise<AllDebridDownloadEntry[] | null> {
    logger.log(
      `[AllDebrid] Starting download URL resolution for uri=${this.shorten(uri)}`
    );
    if (!uri.startsWith("magnet:")) {
      const unlockData = await this.unlockLink(uri);
      const decoded = decodeURIComponent(unlockData.link);
      const filename =
        unlockData.filename || this.extractFilenameFromLink(decoded);

      logger.log(
        `[AllDebrid] Resolved direct link URL=${this.shorten(decoded)} filename=${filename} filesize=${unlockData.filesize ?? "unknown"}`
      );

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
    logger.log(
      `[AllDebrid] Magnet status id=${magnetId} state=${magnetStatus?.status ?? "unknown"} statusCode=${statusCode ?? "unknown"}`
    );

    // statusCode 4 = Ready, 5+ = Error, 0-3 = Still processing
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
        `[AllDebrid] No downloadable links available for magnet id=${magnetId} (status=${magnetStatus?.status ?? "unknown"})`
      );
      return null;
    }

    logger.log(
      `[AllDebrid] Prepared ${links.length} downloadable files for magnet id=${magnetId}`
    );

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
    logger.log(`[AllDebrid] Checking cache availability for URI: ${uri}`);

    if (!uri.startsWith("magnet:")) {
      // Direct links are always "cached" in the sense that they can be unlocked
      logger.log(`[AllDebrid] Direct link — considered cached`);
      return true;
    }

    // For magnets, check if already uploaded and ready without triggering unlock
    const infoHash = this.getMagnetInfoHash(uri);
    if (!infoHash) {
      logger.warn(`[AllDebrid] Could not extract info hash for cache check`);
      return false;
    }

    const userMagnets = await this.getMagnetStatus();
    const existing = userMagnets.find((m) => m.hash.toLowerCase() === infoHash);

    if (!existing) {
      logger.log(`[AllDebrid] Magnet not found in user's list — not cached`);
      return false;
    }

    const cached = existing.statusCode === 4;
    logger.log(
      `[AllDebrid] Cache check result for magnet id=${existing.id}: status=${existing.status} statusCode=${existing.statusCode} cached=${cached}`
    );
    return cached;
  }
}
