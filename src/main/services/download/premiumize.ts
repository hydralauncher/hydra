import axios, { AxiosInstance } from "axios";
import parseTorrent from "parse-torrent";
import type { PremiumizeUser } from "@types";
import { DownloadError } from "@shared";
import { logger } from "@main/services";

/* ------------------------------------------------------------------ */
/*  API response types                                                 */
/* ------------------------------------------------------------------ */

interface PremiumizeBaseResponse {
  status: "success" | "error";
  message?: string;
  error?: string;
}

interface PremiumizeDirectDlContent {
  path: string;
  size: number;
  link: string;
  stream_link?: string;
  transcode_status?: string;
}

interface PremiumizeDirectDlResponse extends PremiumizeBaseResponse {
  location?: string;
  filename?: string;
  filesize?: number;
  content?: PremiumizeDirectDlContent[];
}

interface PremiumizeTransferCreateResponse extends PremiumizeBaseResponse {
  id?: string;
  name?: string;
  type?: string;
}

interface PremiumizeTransfer {
  id: string;
  name: string;
  message?: string;
  status: string;
  progress: number;
  src?: string;
  folder_id?: string;
  file_id?: string;
}

interface PremiumizeTransferListResponse extends PremiumizeBaseResponse {
  transfers?: PremiumizeTransfer[];
}

interface PremiumizeFolderItem {
  id: string;
  name: string;
  type: "file" | "folder";
  size?: number;
  created_at?: number;
  mime_type?: string;
  transcode_status?: string;
  link?: string;
  stream_link?: string;
  virus_scan?: string;
}

interface PremiumizeFolderListResponse extends PremiumizeBaseResponse {
  content?: PremiumizeFolderItem[];
  name?: string;
  parent_id?: string;
  folder_id?: string;
}

interface PremiumizeZipResponse extends PremiumizeBaseResponse {
  location?: string;
}

interface PremiumizeCacheCheckResponse extends PremiumizeBaseResponse {
  response?: boolean[];
  transcoded?: boolean[];
  filename?: string[];
  filesize?: string[];
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
    return new URLSearchParams({
      apikey: this.apiToken,
      ...params,
    });
  }

  private static ensureSuccess(payload: PremiumizeBaseResponse) {
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
      // parse-torrent may throw for malformed URIs
    }

    const match = /xt=urn:btih:([a-z0-9]+)/i.exec(uri);
    const candidate = match?.[1];
    if (!candidate) return null;

    return candidate.toLowerCase();
  }

  static async getUser() {
    const response = await this.instance.get<
      PremiumizeBaseResponse & {
        customer_id?: number;
        premium_until?: number;
        space_used?: number;
        limit_used?: number;
      }
    >("/account/info", {
      params: this.getSearchParams(),
    });

    this.ensureSuccess(response.data);

    return {
      customer_id: String(response.data.customer_id ?? ""),
      premium_until: response.data.premium_until ?? 0,
      space_used: response.data.space_used ?? 0,
      limit_used: response.data.limit_used ?? 0,
    } satisfies PremiumizeUser;
  }

  private static async directDownload(
    uri: string
  ): Promise<PremiumizeDirectDlResponse | null> {
    try {
      const response = await this.instance.post<PremiumizeDirectDlResponse>(
        "/transfer/directdl",
        this.getSearchParams({ src: uri })
      );

      if (response.data.status !== "success") {
        logger.warn(
          `[Premiumize] /transfer/directdl failed: ${response.data.message ?? response.data.error ?? "unknown"}`
        );
        return null;
      }

      return response.data;
    } catch (err) {
      logger.warn(`[Premiumize] /transfer/directdl error:`, err);
      return null;
    }
  }

  private static async createTransfer(
    src: string,
    folderId?: string
  ): Promise<PremiumizeTransferCreateResponse | null> {
    try {
      const params = this.getSearchParams({ src });
      if (folderId) params.set("folder_id", folderId);

      const response =
        await this.instance.post<PremiumizeTransferCreateResponse>(
          "/transfer/create",
          params
        );

      if (response.data.status !== "success") {
        logger.warn(
          `[Premiumize] /transfer/create failed: ${response.data.message ?? response.data.error ?? "unknown"}`
        );
        return null;
      }

      return response.data;
    } catch (err) {
      logger.warn(`[Premiumize] /transfer/create error:`, err);
      return null;
    }
  }

  private static async listTransfers(): Promise<PremiumizeTransfer[]> {
    const response = await this.instance.get<PremiumizeTransferListResponse>(
      "/transfer/list",
      { params: this.getSearchParams() }
    );
    this.ensureSuccess(response.data);
    return response.data.transfers ?? [];
  }

  static async clearFinishedTransfers(): Promise<void> {
    const response = await this.instance.post<PremiumizeBaseResponse>(
      "/transfer/clearfinished",
      this.getSearchParams()
    );
    this.ensureSuccess(response.data);
  }

  private static async listFolder(
    id?: string
  ): Promise<PremiumizeFolderItem[]> {
    const params = this.getSearchParams();
    if (id) params.set("id", id);

    const response = await this.instance.get<PremiumizeFolderListResponse>(
      "/folder/list",
      { params }
    );
    this.ensureSuccess(response.data);
    return response.data.content ?? [];
  }

  private static async generateZip(
    fileIds: string[],
    folderIds: string[]
  ): Promise<string> {
    const params = this.getSearchParams();
    for (const fid of fileIds) params.append("files[]", fid);
    for (const fid of folderIds) params.append("folders[]", fid);

    const response = await this.instance.post<PremiumizeZipResponse>(
      "/zip/generate",
      params
    );
    this.ensureSuccess(response.data);

    if (!response.data.location) {
      throw new Error("[Premiumize] /zip/generate did not return a location");
    }

    return response.data.location;
  }

  static async isCached(uri: string) {
    let item = uri;
    if (uri.startsWith("magnet:")) {
      const infoHash = this.getMagnetInfoHash(uri);
      if (!infoHash) {
        logger.warn(`[Premiumize] Could not extract info hash for cache check`);
        return false;
      }
      item = infoHash;
    }

    const response = await this.instance.get<PremiumizeCacheCheckResponse>(
      "/cache/check",
      {
        params: this.getSearchParams({ "items[]": item }),
      }
    );
    this.ensureSuccess(response.data);

    const [cached] = response.data.response ?? [];
    return Boolean(cached);
  }

  private static readonly TRANSFER_POLL_INTERVAL_MS = 5000;
  private static readonly TRANSFER_MAX_ATTEMPTS = 360; // 30 minutes

  private static async waitForTransfer(
    transferId: string
  ): Promise<PremiumizeTransfer> {
    for (let attempt = 1; attempt <= this.TRANSFER_MAX_ATTEMPTS; attempt++) {
      const transfers = await this.listTransfers();
      const transfer = transfers.find((t) => t.id === transferId);

      if (!transfer) {
        return {
          id: transferId,
          name: "",
          status: "finished",
          progress: 1,
        };
      }

      const status = transfer.status.toLowerCase();

      if (status === "finished" || status === "seeding") {
        return transfer;
      }

      if (status === "error" || status === "banned" || status === "timeout") {
        throw new Error(
          `[Premiumize] Transfer failed: ${transfer.message ?? transfer.status}`
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, this.TRANSFER_POLL_INTERVAL_MS)
      );
    }

    throw new Error(
      `[Premiumize] Transfer ${transferId} timed out after ${this.TRANSFER_MAX_ATTEMPTS} attempts`
    );
  }

  private static extractSingleLink(
    directDl: PremiumizeDirectDlResponse | null
  ): string | null {
    const content = directDl?.content ?? [];
    if (content.length === 1 && content[0].link) {
      return decodeURIComponent(content[0].link);
    }
    return null;
  }

  static async getDownloadUrl(uri: string): Promise<string | null> {
    const directDl = await this.directDownload(uri);
    const content = directDl?.content ?? [];

    const singleLink = this.extractSingleLink(directDl);
    if (singleLink) return singleLink;

    if (content.length > 1) return this.resolveMultiFileAsZip(uri);

    if (uri.startsWith("magnet:")) {
      const startedTransfer = await this.startTransferInBackground(uri);
      if (startedTransfer) {
        throw new Error(DownloadError.PremiumizeTransferStarted);
      }

      logger.warn(
        `[Premiumize] Magnet could not be resolved via direct download`
      );
      return null;
    }

    if (uri.startsWith("http")) {
      return this.resolveViaTransfer(uri);
    }

    logger.warn(`[Premiumize] Could not resolve download URL`);
    return null;
  }

  private static async resolveMultiFileAsZip(
    uri: string
  ): Promise<string | null> {
    const transfer = await this.ensureTransferCompleted(uri);
    if (!transfer) return null;

    return this.zipTransferContents(transfer);
  }

  private static async resolveViaTransfer(uri: string): Promise<string | null> {
    const transfer = await this.ensureTransferCompleted(uri);

    const retryDl = await this.directDownload(uri);
    const retryContent = retryDl?.content ?? [];

    const singleLink = this.extractSingleLink(retryDl);
    if (singleLink) return singleLink;

    if (retryContent.length > 1 && transfer) {
      return this.zipTransferContents(transfer);
    }

    if (transfer) return this.zipTransferContents(transfer);

    return this.resolveFromRootFolder(uri);
  }

  private static async ensureTransferCompleted(
    uri: string
  ): Promise<PremiumizeTransfer | null> {
    const created = await this.createTransfer(uri);

    if (created?.id) {
      try {
        return await this.waitForTransfer(created.id);
      } catch (err) {
        logger.error(
          `[Premiumize] waitForTransfer failed for id=${created.id}:`,
          err
        );
      }
    }

    return this.findExistingTransfer(uri);
  }

  private static async findExistingTransfer(
    uri: string
  ): Promise<PremiumizeTransfer | null> {
    try {
      const infoHash = uri.startsWith("magnet:")
        ? this.getMagnetInfoHash(uri)
        : null;

      const transfers = await this.listTransfers();

      const match = transfers.find((t) => {
        if (t.src === uri) return true;
        if (infoHash && t.src?.toLowerCase().includes(infoHash)) return true;
        return false;
      });

      if (!match) return null;

      const status = match.status.toLowerCase();
      if (status === "finished" || status === "seeding") {
        return match;
      }

      if (status === "error" || status === "banned" || status === "timeout") {
        logger.error(
          `[Premiumize] Existing transfer is in error state: ${match.message ?? match.status}`
        );
        return null;
      }

      return await this.waitForTransfer(match.id);
    } catch (err) {
      logger.error(`[Premiumize] findExistingTransfer failed:`, err);
      return null;
    }
  }

  private static async hasRunnableTransfer(uri: string): Promise<boolean> {
    try {
      const infoHash = uri.startsWith("magnet:")
        ? this.getMagnetInfoHash(uri)
        : null;
      const transfers = await this.listTransfers();
      const match = transfers.find((t) => {
        if (t.src === uri) return true;
        if (infoHash && t.src?.toLowerCase().includes(infoHash)) return true;
        return false;
      });
      if (!match) return false;

      const status = match.status.toLowerCase();
      return !["error", "banned", "timeout"].includes(status);
    } catch (err) {
      logger.warn(`[Premiumize] hasRunnableTransfer failed:`, err);
      return false;
    }
  }

  private static async startTransferInBackground(
    uri: string
  ): Promise<boolean> {
    const created = await this.createTransfer(uri);
    if (created?.id) {
      return true;
    }

    const hasExistingTransfer = await this.hasRunnableTransfer(uri);
    if (hasExistingTransfer) {
      return true;
    }

    return false;
  }

  private static async resolveFromRootFolder(
    uri: string
  ): Promise<string | null> {
    try {
      const infoHash = uri.startsWith("magnet:")
        ? this.getMagnetInfoHash(uri)
        : null;
      if (!infoHash) return null;

      const rootItems = await this.listFolder();

      const magnetDn = this.extractDisplayName(uri);
      const folder = rootItems.find(
        (item) =>
          item.type === "folder" &&
          magnetDn &&
          item.name.toLowerCase().includes(magnetDn.toLowerCase())
      );

      if (folder) return this.generateZip([], [folder.id]);

      const file = rootItems.find(
        (item) =>
          item.type === "file" &&
          item.link &&
          magnetDn &&
          item.name.toLowerCase().includes(magnetDn.toLowerCase())
      );

      if (file?.link) return decodeURIComponent(file.link);

      logger.warn(`[Premiumize] Could not find content in root folder`);
      return null;
    } catch (err) {
      logger.error(`[Premiumize] resolveFromRootFolder failed:`, err);
      return null;
    }
  }

  private static extractDisplayName(uri: string): string | null {
    const match = /[?&]dn=([^&]+)/i.exec(uri);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]).replaceAll("+", " ");
    } catch {
      return match[1].replaceAll("+", " ");
    }
  }

  private static async zipTransferContents(
    transfer: PremiumizeTransfer
  ): Promise<string | null> {
    try {
      if (transfer.folder_id) {
        return await this.generateZip([], [transfer.folder_id]);
      }

      if (transfer.file_id) {
        return await this.generateZip([transfer.file_id], []);
      }

      logger.warn(
        `[Premiumize] Transfer ${transfer.id} has no folder_id or file_id`
      );
      return null;
    } catch (err) {
      logger.error(`[Premiumize] Zip generation failed:`, err);
      return null;
    }
  }
}
