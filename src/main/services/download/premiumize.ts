import axios, { AxiosInstance } from "axios";
import parseTorrent from "parse-torrent";
import type { PremiumizeUser } from "@types";
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

/* ------------------------------------------------------------------ */
/*  Client                                                             */
/* ------------------------------------------------------------------ */

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
      // Fallback below handles raw xt values when parse-torrent cannot parse the URI.
    }

    const match = /xt=urn:btih:([a-z0-9]+)/i.exec(uri);
    const candidate = match?.[1];
    if (!candidate) return null;

    return candidate.toLowerCase();
  }

  private static shorten(value: string, max = 120) {
    if (value.length <= max) return value;
    return `${value.slice(0, max)}...`;
  }

  /* ---------------------------------------------------------------- */
  /*  Account                                                          */
  /* ---------------------------------------------------------------- */

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

  /* ---------------------------------------------------------------- */
  /*  Transfer endpoints                                               */
  /* ---------------------------------------------------------------- */

  /**
   * POST /transfer/directdl — resolve cached content into direct download links.
   * Returns the full content array (which may contain multiple files for magnets).
   * Never throws — returns null on any error.
   */
  private static async directDownload(
    uri: string
  ): Promise<PremiumizeDirectDlResponse | null> {
    logger.log(`[Premiumize] POST /transfer/directdl src=${this.shorten(uri)}`);

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

      const content = response.data.content ?? [];
      logger.log(
        `[Premiumize] /transfer/directdl returned ${content.length} file(s), ` +
          `location=${this.shorten(response.data.location ?? "none")} ` +
          `filename=${response.data.filename ?? "unknown"} ` +
          `filesize=${response.data.filesize ?? "unknown"}`
      );

      return response.data;
    } catch (err) {
      logger.warn(`[Premiumize] /transfer/directdl threw:`, err);
      return null;
    }
  }

  /**
   * POST /transfer/create — add a magnet/link as a cloud transfer.
   * Returns null if the transfer could not be created (e.g. already exists).
   */
  private static async createTransfer(
    src: string,
    folderId?: string
  ): Promise<PremiumizeTransferCreateResponse | null> {
    logger.log(`[Premiumize] POST /transfer/create src=${this.shorten(src)}`);

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

      logger.log(
        `[Premiumize] /transfer/create id=${response.data.id ?? "none"} name=${response.data.name ?? "unknown"} type=${response.data.type ?? "unknown"}`
      );
      return response.data;
    } catch (err) {
      logger.warn(`[Premiumize] /transfer/create threw:`, err);
      return null;
    }
  }

  /**
   * GET /transfer/list — list all transfers.
   */
  private static async listTransfers(): Promise<PremiumizeTransfer[]> {
    const response = await this.instance.get<PremiumizeTransferListResponse>(
      "/transfer/list",
      { params: this.getSearchParams() }
    );
    this.ensureSuccess(response.data);
    return response.data.transfers ?? [];
  }

  /**
   * POST /transfer/clearfinished — clean up finished transfers.
   */
  static async clearFinishedTransfers(): Promise<void> {
    logger.log(`[Premiumize] POST /transfer/clearfinished`);
    const response = await this.instance.post<PremiumizeBaseResponse>(
      "/transfer/clearfinished",
      this.getSearchParams()
    );
    this.ensureSuccess(response.data);
  }

  /* ---------------------------------------------------------------- */
  /*  Folder endpoints                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * GET /folder/list — list contents of a folder (root if id is omitted).
   */
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

  /* ---------------------------------------------------------------- */
  /*  Zip endpoint                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * POST /zip/generate — generate a zip archive from files/folders and
   * return the download URL.
   */
  private static async generateZip(
    fileIds: string[],
    folderIds: string[]
  ): Promise<string> {
    logger.log(
      `[Premiumize] POST /zip/generate files=${fileIds.length} folders=${folderIds.length}`
    );

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

    logger.log(
      `[Premiumize] /zip/generate location=${this.shorten(response.data.location)}`
    );
    return response.data.location;
  }

  /* ---------------------------------------------------------------- */
  /*  Cache check                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * GET /cache/check — check if a link/magnet is available as cached content.
   */
  static async isCached(uri: string) {
    logger.log(`[Premiumize] Checking cache for: ${this.shorten(uri)}`);

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
    const result = Boolean(cached);
    logger.log(
      `[Premiumize] Cache check result: ${result} ` +
        `filename=${response.data.filename?.[0] ?? "unknown"} ` +
        `filesize=${response.data.filesize?.[0] ?? "unknown"}`
    );
    return result;
  }

  /* ---------------------------------------------------------------- */
  /*  Transfer polling                                                 */
  /* ---------------------------------------------------------------- */

  private static readonly TRANSFER_POLL_INTERVAL_MS = 5000;
  private static readonly TRANSFER_MAX_ATTEMPTS = 360; // 30 minutes

  /**
   * Poll /transfer/list until a specific transfer reaches a terminal state.
   * Returns the completed transfer object.
   */
  private static async waitForTransfer(
    transferId: string
  ): Promise<PremiumizeTransfer> {
    for (let attempt = 1; attempt <= this.TRANSFER_MAX_ATTEMPTS; attempt++) {
      const transfers = await this.listTransfers();
      const transfer = transfers.find((t) => t.id === transferId);

      if (!transfer) {
        logger.log(
          `[Premiumize] Transfer ${transferId} no longer in list — assuming finished`
        );
        // Transfer may have auto-cleared; return a synthetic "finished" state
        return {
          id: transferId,
          name: "",
          status: "finished",
          progress: 1,
        };
      }

      logger.log(
        `[Premiumize] Transfer ${transferId} status=${transfer.status} progress=${transfer.progress} ` +
          `folder_id=${transfer.folder_id ?? "none"} file_id=${transfer.file_id ?? "none"} ` +
          `(attempt ${attempt}/${this.TRANSFER_MAX_ATTEMPTS})`
      );

      const status = transfer.status.toLowerCase();

      if (status === "finished" || status === "seeding") {
        return transfer;
      }

      if (status === "error" || status === "banned" || status === "timeout") {
        throw new Error(
          `[Premiumize] Transfer failed: ${transfer.message ?? transfer.status}`
        );
      }

      // Still processing (waiting, queued, running, downloading, etc.)
      await new Promise((resolve) =>
        setTimeout(resolve, this.TRANSFER_POLL_INTERVAL_MS)
      );
    }

    throw new Error(
      `[Premiumize] Transfer ${transferId} timed out after ${this.TRANSFER_MAX_ATTEMPTS} attempts`
    );
  }

  /* ---------------------------------------------------------------- */
  /*  High-level download URL resolution                               */
  /* ---------------------------------------------------------------- */

  /**
   * Try to extract a single download URL from a directdl response.
   * Returns the link for single-file content, null otherwise.
   */
  private static extractSingleLink(
    directDl: PremiumizeDirectDlResponse | null
  ): string | null {
    const content = directDl?.content ?? [];
    if (content.length === 1 && content[0].link) {
      return decodeURIComponent(content[0].link);
    }
    return null;
  }

  /**
   * Resolve a URI into a single download URL.
   *
   * Strategy:
   * 1. Try /transfer/directdl (instant for cached content).
   * 2. If directdl returned multiple files → zip them.
   * 3. If directdl failed → create a cloud transfer, wait, then retry directdl.
   * 4. If retry directdl has multiple files → zip them.
   * 5. If retry directdl still fails → find the folder from the transfer and zip it.
   */
  static async getDownloadUrl(uri: string): Promise<string | null> {
    logger.log(`[Premiumize] Resolving download URL for: ${this.shorten(uri)}`);

    // --- Step 1: Try directdl (works for cached content) ---
    const directDl = await this.directDownload(uri);
    const content = directDl?.content ?? [];

    const singleLink = this.extractSingleLink(directDl);
    if (singleLink) {
      logger.log(
        `[Premiumize] Single file — using direct link: ${this.shorten(singleLink)}`
      );
      return singleLink;
    }

    // --- Step 2: Multiple files from directdl → zip ---
    if (content.length > 1) {
      logger.log(
        `[Premiumize] ${content.length} files detected — using zip approach`
      );
      return this.resolveMultiFileAsZip(uri);
    }

    // --- Step 3: directdl returned nothing → create transfer, wait, then resolve ---
    if (uri.startsWith("magnet:") || uri.startsWith("http")) {
      logger.log(
        `[Premiumize] directdl returned no content — creating transfer`
      );
      return this.resolveViaTransfer(uri);
    }

    logger.warn(`[Premiumize] Could not resolve download URL`);
    return null;
  }

  /**
   * Multi-file path: create transfer → wait → zip the resulting folder.
   */
  private static async resolveMultiFileAsZip(
    uri: string
  ): Promise<string | null> {
    const transfer = await this.ensureTransferCompleted(uri);
    if (!transfer) return null;

    return this.zipTransferContents(transfer);
  }

  /**
   * Fallback path when directdl returned nothing:
   * create/find transfer → wait → retry directdl → if still multi → zip.
   */
  private static async resolveViaTransfer(uri: string): Promise<string | null> {
    const transfer = await this.ensureTransferCompleted(uri);

    // After transfer is complete, content should now be cached — retry directdl
    logger.log(`[Premiumize] Transfer complete — retrying directdl`);
    const retryDl = await this.directDownload(uri);
    const retryContent = retryDl?.content ?? [];

    // Single file → direct link
    const singleLink = this.extractSingleLink(retryDl);
    if (singleLink) {
      logger.log(
        `[Premiumize] Retry: single file — using direct link: ${this.shorten(singleLink)}`
      );
      return singleLink;
    }

    // Multiple files → zip
    if (retryContent.length > 1 && transfer) {
      logger.log(
        `[Premiumize] Retry: ${retryContent.length} files — using zip`
      );
      return this.zipTransferContents(transfer);
    }

    // directdl still failed — try to zip from transfer folder_id/file_id
    if (transfer) {
      logger.log(
        `[Premiumize] Retry directdl failed — attempting zip from transfer ids`
      );
      return this.zipTransferContents(transfer);
    }

    // Last resort: find the folder by searching the root folder for magnet content
    logger.log(
      `[Premiumize] No transfer info — searching root folder for content`
    );
    return this.resolveFromRootFolder(uri);
  }

  /**
   * Create a new transfer or find an existing one, then wait for completion.
   */
  private static async ensureTransferCompleted(
    uri: string
  ): Promise<PremiumizeTransfer | null> {
    // Try creating a new transfer
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

    // createTransfer failed (already exists?) or waitForTransfer failed
    // Try to find an existing finished transfer for this URI
    logger.log(`[Premiumize] Looking for existing transfer matching URI`);
    return this.findExistingTransfer(uri);
  }

  /**
   * Search the transfer list for an existing transfer matching the URI.
   * If found and still processing, waits for it.
   */
  private static async findExistingTransfer(
    uri: string
  ): Promise<PremiumizeTransfer | null> {
    try {
      const infoHash = uri.startsWith("magnet:")
        ? this.getMagnetInfoHash(uri)
        : null;

      const transfers = await this.listTransfers();

      // Try to match by src or by magnet info hash
      const match = transfers.find((t) => {
        if (t.src === uri) return true;
        if (infoHash && t.src?.toLowerCase().includes(infoHash)) return true;
        return false;
      });

      if (!match) {
        logger.log(`[Premiumize] No existing transfer found for URI`);
        return null;
      }

      logger.log(
        `[Premiumize] Found existing transfer id=${match.id} status=${match.status}`
      );

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

      // Still processing — wait for it
      return await this.waitForTransfer(match.id);
    } catch (err) {
      logger.error(`[Premiumize] findExistingTransfer failed:`, err);
      return null;
    }
  }

  /**
   * Last resort: browse the root folder to find content matching the magnet,
   * then zip whatever folder we find.
   */
  private static async resolveFromRootFolder(
    uri: string
  ): Promise<string | null> {
    try {
      const infoHash = uri.startsWith("magnet:")
        ? this.getMagnetInfoHash(uri)
        : null;
      if (!infoHash) return null;

      const rootItems = await this.listFolder();

      // Look for a folder whose name might match the magnet display name
      const magnetDn = this.extractDisplayName(uri);
      const folder = rootItems.find(
        (item) =>
          item.type === "folder" &&
          magnetDn &&
          item.name.toLowerCase().includes(magnetDn.toLowerCase())
      );

      if (folder) {
        logger.log(
          `[Premiumize] Found matching folder in root: id=${folder.id} name=${folder.name}`
        );
        return this.generateZip([], [folder.id]);
      }

      // Single file match
      const file = rootItems.find(
        (item) =>
          item.type === "file" &&
          item.link &&
          magnetDn &&
          item.name.toLowerCase().includes(magnetDn.toLowerCase())
      );

      if (file?.link) {
        logger.log(
          `[Premiumize] Found matching file in root: id=${file.id} name=${file.name}`
        );
        return decodeURIComponent(file.link);
      }

      logger.warn(`[Premiumize] Could not find content in root folder`);
      return null;
    } catch (err) {
      logger.error(`[Premiumize] resolveFromRootFolder failed:`, err);
      return null;
    }
  }

  /**
   * Extract the display name (dn) from a magnet URI.
   */
  private static extractDisplayName(uri: string): string | null {
    const match = /[?&]dn=([^&]+)/i.exec(uri);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]).replace(/\+/g, " ");
    } catch {
      return match[1].replace(/\+/g, " ");
    }
  }

  /**
   * Zip the contents of a completed transfer and return the zip URL.
   */
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
