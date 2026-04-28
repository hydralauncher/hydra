import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../logger";
import { SystemPath } from "../system-path";

export interface GofileAccountsReponse {
  id: string;
  token: string;
}

export interface GofileContentChild {
  id: string;
  type: string;
  name?: string;
  link?: string;
  canAccess?: boolean;
}

export interface GofileContentsResponse {
  id: string;
  type: string;
  name?: string;
  link?: string;
  children?: Record<string, GofileContentChild>;
  canAccess?: boolean;
  password?: boolean;
  passwordStatus?: string;
  public?: boolean;
  expire?: number;
}

export interface GofileContentMetadata {
  page?: number;
  totalPages?: number;
  pageSize?: number;
}

interface GofileGuestTokenCache {
  version: number;
  token: string;
  createdAt: number;
}

class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class GofileApi {
  private static readonly defaultUserAgent =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  private static readonly language = "en-US";
  private static readonly timeoutMs = 15000;
  private static readonly websiteTokenSecret = "5d4f7g8sd45fsd";
  private static readonly pageSize = 1000;
  private static readonly cacheVersion = 1;
  private static token?: string;
  private static authorizePromise?: Promise<string>;

  private static get userAgent() {
    return (
      process.env.GOFILE_USER_AGENT ??
      process.env.GF_USERAGENT ??
      this.defaultUserAgent
    );
  }

  private static get configuredToken() {
    return process.env.GOFILE_TOKEN?.trim() || undefined;
  }

  private static get cachePath() {
    return path.join(SystemPath.getPath("userData"), "gofile-guest-token.json");
  }

  private static async sleep(ms: number) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private static isRetryableStatus(status: number) {
    return [408, 425, 429, 500, 502, 503, 504].includes(status);
  }

  private static async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = this.timeoutMs
  ) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new RequestTimeoutError(
          `Request timed out: ${init.method} ${url}`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private static generateWebsiteToken(accountToken: string) {
    const timeSlot = Math.floor(Date.now() / 1000 / 14400);
    const raw = `${this.userAgent}::${this.language}::${accountToken}::${timeSlot}::${this.websiteTokenSecret}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  private static hashPassword(password: string) {
    const trimmed = password.trim();
    if (/^[a-f0-9]{64}$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }

    return crypto.createHash("sha256").update(trimmed).digest("hex");
  }

  private static getBaseHeaders(accountToken?: string) {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      "Accept-Encoding": "gzip",
      Accept: "application/json",
      Connection: "keep-alive",
      Origin: "https://gofile.io",
      Referer: "https://gofile.io/",
    };

    if (accountToken) {
      headers.Authorization = `Bearer ${accountToken}`;
    }

    return headers;
  }

  private static async loadCachedGuestToken() {
    try {
      const text = await fs.readFile(this.cachePath, "utf-8");
      const parsed = JSON.parse(text) as Partial<GofileGuestTokenCache>;
      const token = parsed.token?.trim();

      if (!token) {
        return undefined;
      }

      logger.log("[Gofile] Loaded cached guest token");
      return token;
    } catch {
      return undefined;
    }
  }

  private static async persistGuestToken(token: string) {
    const payload: GofileGuestTokenCache = {
      version: this.cacheVersion,
      token,
      createdAt: Date.now(),
    };

    try {
      await fs.writeFile(
        this.cachePath,
        `${JSON.stringify(payload, null, 2)}\n`
      );
      logger.log("[Gofile] Persisted guest token cache");
    } catch (error) {
      logger.warn("[Gofile] Failed to persist guest token cache", error);
    }
  }

  private static async createGuestToken() {
    const requestHeaders = {
      ...this.getBaseHeaders(),
      "X-Website-Token": this.generateWebsiteToken(""),
      "X-BL": this.language,
    };

    logger.log("[Gofile] Creating guest token");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.fetchWithTimeout(
        "https://api.gofile.io/accounts",
        {
          method: "POST",
          headers: requestHeaders,
        }
      );

      const payload = (await response.json()) as {
        status?: string;
        data?: GofileAccountsReponse;
      };

      if (payload.status === "ok" && payload.data?.token) {
        logger.log("[Gofile] Guest token created");
        await this.persistGuestToken(payload.data.token);
        return payload.data.token;
      }

      if (
        attempt < 2 &&
        (payload.status === "error-rateLimit" ||
          this.isRetryableStatus(response.status))
      ) {
        await this.sleep(2 ** attempt * 1000);
        continue;
      }

      throw new Error(
        `Account creation failed: ${payload.status ?? response.status}`
      );
    }

    throw new Error("Account creation failed after all retries");
  }

  public static initialize() {
    logger.log("[Gofile] Initializing guest token");

    this.authorize().catch((error) => {
      logger.error("[Gofile] Failed to initialize guest token", error);
    });
  }

  public static async authorize(forceRefresh = false) {
    const configuredToken = this.configuredToken;
    if (configuredToken) {
      if (this.token !== configuredToken) {
        logger.log("[Gofile] Using configured account token");
      }

      this.token = configuredToken;
      return configuredToken;
    }

    if (!forceRefresh && this.token) {
      return this.token;
    }

    if (!forceRefresh && this.authorizePromise) {
      return this.authorizePromise;
    }

    this.authorizePromise = (async () => {
      if (!forceRefresh) {
        const cachedToken = await this.loadCachedGuestToken();
        if (cachedToken) {
          this.token = cachedToken;
          return cachedToken;
        }
      }

      const token = await this.createGuestToken();
      this.token = token;
      return token;
    })().finally(() => {
      this.authorizePromise = undefined;
    });

    return this.authorizePromise;
  }

  public static async getDownloadLink(id: string, password?: string) {
    logger.log(`[Gofile] Resolving download link for content ${id}`);

    let token = await this.authorize();
    let link: string | null;

    try {
      link = await this.parseLinksRecursively(id, token, password);
    } catch (error) {
      if (this.configuredToken || !this.isLikelyTokenAuthError(error)) {
        throw error;
      }

      logger.warn("[Gofile] Guest token rejected; refreshing and retrying");
      token = await this.authorize(true);
      link = await this.parseLinksRecursively(id, token, password);
    }

    if (!link) {
      throw new Error("No file links found in folder contents");
    }

    logger.log(`[Gofile] Download link resolved for content ${id}`);
    return link;
  }

  private static async parseLinksRecursively(
    id: string,
    accountToken: string,
    password?: string,
    visitedFolders = new Set<string>()
  ): Promise<string | null> {
    if (visitedFolders.has(id)) {
      return null;
    }

    visitedFolders.add(id);
    logger.log(`[Gofile] Fetching content ${id}`);

    const firstPage = await this.getContentPage(id, accountToken, 1, password);
    const totalPages = Math.max(1, firstPage.metadata?.totalPages ?? 1);
    const pages = [firstPage.data];

    for (let page = 2; page <= totalPages; page += 1) {
      logger.log(`[Gofile] Fetching content ${id} page ${page}/${totalPages}`);
      pages.push(
        (await this.getContentPage(id, accountToken, page, password)).data
      );
    }

    for (const content of pages) {
      if (content.type === "file") {
        return content.link ?? null;
      }

      if (content.type !== "folder") {
        throw new Error("Unsupported content type");
      }

      const children = Object.values(content.children ?? {});
      for (const child of children) {
        if (child.type === "file" && child.link) {
          logger.log(`[Gofile] Found file in content ${id}`);
          return child.link;
        }

        if (child.type === "folder") {
          if (child.canAccess === false) {
            logger.warn(`[Gofile] Skipping inaccessible folder ${child.id}`);
            continue;
          }

          const nestedLink = await this.parseLinksRecursively(
            child.id,
            accountToken,
            password,
            visitedFolders
          );

          if (nestedLink) {
            return nestedLink;
          }
        }
      }
    }

    return null;
  }

  private static async getContentPage(
    id: string,
    accountToken: string,
    page: number,
    password?: string
  ) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(this.pageSize),
      sortField: "createTime",
      sortDirection: "-1",
    });

    if (password) {
      params.set("password", this.hashPassword(password));
    }

    const requestHeaders = {
      ...this.getBaseHeaders(accountToken),
      "X-Website-Token": this.generateWebsiteToken(accountToken),
      "X-BL": this.language,
    };

    const response = await this.fetchWithTimeout(
      `https://api.gofile.io/contents/${id}?${params.toString()}`,
      {
        method: "GET",
        headers: requestHeaders,
      }
    );

    const payload = (await response.json()) as {
      status?: string;
      data?: GofileContentsResponse;
      metadata?: GofileContentMetadata;
    };

    if (payload.status === "error-rateLimit" || response.status === 429) {
      throw new Error(
        "RATE_LIMIT:Gofile rate limit reached. Please enable a VPN and try again in a few minutes."
      );
    }

    if (payload.status !== "ok" || !payload.data) {
      throw new Error(this.statusToMessage(payload.status ?? "unknown", id));
    }

    if (payload.data.canAccess === false) {
      throw new Error(this.accessErrorMessage(payload.data, id));
    }

    return {
      status: payload.status,
      data: payload.data,
      metadata: payload.metadata,
    };
  }

  private static statusToMessage(status: string, context: string) {
    switch (status) {
      case "error-notFound":
        return `Content not found: ${context}`;
      case "error-notPremium":
        return "Gofile denied access with error-notPremium for this request/content.";
      case "error-passwordRequired":
        return `Content ${context} requires a password.`;
      case "error-passwordWrong":
        return `Password is incorrect for content ${context}.`;
      case "error-wrongToken":
      case "error-notAuthenticated":
        return "The Gofile token is invalid or expired.";
      default:
        return `Gofile API returned ${status} for ${context}.`;
    }
  }

  private static accessErrorMessage(
    data: GofileContentsResponse,
    contentId: string
  ) {
    if (data.password === true) {
      if (data.passwordStatus === "passwordRequired") {
        return `Content ${contentId} is password protected.`;
      }

      if (data.passwordStatus === "passwordWrong") {
        return `Password for content ${contentId} is incorrect.`;
      }
    }

    if (data.public === false) {
      return `Content ${contentId} is private.`;
    }

    if (typeof data.expire === "number") {
      return `Content ${contentId} has expired.`;
    }

    return `Content ${contentId} is not accessible.`;
  }

  private static isLikelyTokenAuthError(error: unknown) {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes("invalid or expired") ||
      message.includes("notauthenticated") ||
      message.includes("wrongtoken") ||
      message.includes("badtoken") ||
      message.includes("authorization")
    );
  }

  public static async checkDownloadUrl(url: string) {
    const token = await this.authorize();
    const response = await this.fetchWithTimeout(url, {
      method: "HEAD",
      headers: {
        Cookie: `accountToken=${token}`,
      },
    });

    if (response.status === 429) {
      throw new Error(
        "RATE_LIMIT:Gofile rate limit reached. Please enable a VPN and try again in a few minutes."
      );
    }

    if (!response.ok) {
      throw new Error(`Failed to validate download URL: ${response.status}`);
    }

    logger.log(`[Gofile] Download URL HEAD check returned ${response.status}`);
    return response;
  }
}
