import crypto from "node:crypto";
import vm from "node:vm";

export interface GofileAccountsReponse {
  id: string;
  token: string;
}

export interface GofileContentChild {
  id: string;
  type: string;
  link?: string;
}

export interface GofileContentsResponse {
  id: string;
  type: string;
  link?: string;
  children?: Record<string, GofileContentChild>;
}

class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class GofileApi {
  private static readonly defaultUserAgent = "Mozilla/5.0";
  private static readonly language = "en-US";
  private static readonly timeoutMs = 15000;
  private static readonly accountCreationRetries = 3;
  private static readonly wtScriptRetries = 3;
  private static readonly wtGenerationRetries = 2;
  private static readonly wtScriptCacheTtlMs = 6 * 60 * 60 * 1000;
  private static readonly wtScriptUrl = "https://gofile.io/dist/js/wt.obf.js";

  private static token: string;
  private static wtScriptSource: string | null = null;
  private static wtScriptFetchedAt = 0;

  private static get userAgent() {
    return process.env.GF_USERAGENT ?? this.defaultUserAgent;
  }

  private static async sleep(ms: number) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private static isRetryableNetworkError(error: unknown) {
    return (
      error instanceof RequestTimeoutError ||
      (error instanceof TypeError && error.message.includes("fetch failed"))
    );
  }

  private static isRetryableStatus(status: number) {
    return [408, 425, 500, 502, 503, 504].includes(status);
  }

  private static getBaseHeaders(accountToken?: string) {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      "Accept-Encoding": "gzip",
      Accept: "*/*",
      Connection: "keep-alive",
      Origin: "https://gofile.io",
      Referer: "https://gofile.io/",
    };

    if (accountToken) {
      headers.Authorization = `Bearer ${accountToken}`;
    }

    return headers;
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

  private static clearWtScriptCache() {
    this.wtScriptSource = null;
    this.wtScriptFetchedAt = 0;
  }

  private static async loadWtScriptSource(forceRefresh = false) {
    const isFresh =
      Date.now() - this.wtScriptFetchedAt < this.wtScriptCacheTtlMs;

    if (!forceRefresh && this.wtScriptSource && isFresh) {
      return this.wtScriptSource;
    }

    let lastError: unknown;

    for (let attempt = 0; attempt < this.wtScriptRetries; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(this.wtScriptUrl, {
          method: "GET",
          headers: this.getBaseHeaders(),
        });

        if (!response.ok) {
          if (
            attempt < this.wtScriptRetries - 1 &&
            this.isRetryableStatus(response.status)
          ) {
            await this.sleep(2 ** attempt * 1000);
            continue;
          }

          throw new Error(
            `GoFile WT script request failed with status ${response.status}`
          );
        }

        const source = await response.text();

        if (!source.includes("generateWT")) {
          throw new Error("GoFile WT script does not expose generateWT");
        }

        this.wtScriptSource = source;
        this.wtScriptFetchedAt = Date.now();
        return source;
      } catch (error) {
        lastError = error;

        if (
          attempt < this.wtScriptRetries - 1 &&
          this.isRetryableNetworkError(error)
        ) {
          await this.sleep(2 ** attempt * 1000);
          continue;
        }

        break;
      }
    }

    throw new Error(
      `Failed to load GoFile website-token script: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private static executeGenerateWt(scriptSource: string, accountToken: string) {
    const context: Record<string, unknown> = {
      navigator: {
        userAgent: this.userAgent,
        language: this.language,
      },
      window: {},
      document: {},
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      Math,
    };

    context.window = context;
    context.self = context;
    context.globalThis = context;

    const sandbox = vm.createContext(context, {
      name: "hydra-gofile-wt",
    });

    const wrapped =
      `"use strict";\n${scriptSource}\n` +
      `if (typeof generateWT !== "function") { throw new Error("Missing generateWT"); }\n` +
      `generateWT(${JSON.stringify(accountToken)});`;

    const script = new vm.Script(wrapped, {
      filename: "gofile-wt.obf.js",
    });

    const value = script.runInContext(sandbox, {
      timeout: 1200,
    });

    if (typeof value !== "string" || value.length === 0) {
      throw new Error("GoFile generateWT returned an invalid value");
    }

    return value;
  }

  private static async generateWebsiteToken(accountToken: string) {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.wtGenerationRetries; attempt += 1) {
      try {
        const source = await this.loadWtScriptSource(attempt > 0);
        return this.executeGenerateWt(source, accountToken);
      } catch (error) {
        lastError = error;
        this.clearWtScriptCache();
      }
    }

    throw new Error(
      `Failed to generate GoFile website token: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  public static async authorize() {
    for (let retry = 0; retry < this.accountCreationRetries; retry += 1) {
      const requestHeaders = {
        ...this.getBaseHeaders(),
        "X-Website-Token": await this.generateWebsiteToken(""),
        "X-BL": this.language,
      };

      try {
        const response = await this.fetchWithTimeout(
          "https://api.gofile.io/accounts",
          {
            method: "POST",
            headers: requestHeaders,
          }
        );

        const payload =
          /** @type {{ status?: string; data?: GofileAccountsReponse }} */ await response.json();

        if (payload.status === "ok" && payload.data?.token) {
          this.token = payload.data.token;
          return this.token;
        }

        if (payload.status === "error-rateLimit" || response.status === 429) {
          throw new Error(
            "RATE_LIMIT:Gofile rate limit reached. Please enable a VPN and try again in a few minutes."
          );
        }

        if (
          retry < this.accountCreationRetries - 1 &&
          this.isRetryableStatus(response.status)
        ) {
          await this.sleep(2 ** retry * 1000);
          continue;
        }

        throw new Error(
          `Account creation failed: ${payload.status ?? "unknown"}`
        );
      } catch (error) {
        if (
          retry < this.accountCreationRetries - 1 &&
          this.isRetryableNetworkError(error)
        ) {
          await this.sleep(2 ** retry * 1000);
          continue;
        }

        if (error instanceof RequestTimeoutError) {
          throw new Error(
            `Account creation timed out after ${this.accountCreationRetries} attempts`
          );
        }

        throw error;
      }
    }

    throw new Error("Account creation failed after all retries");
  }

  public static async getDownloadLink(id: string, password?: string) {
    const hashedPassword = password
      ? crypto.createHash("sha256").update(password).digest("hex")
      : undefined;

    const link = await this.parseLinksRecursively(id, hashedPassword);
    if (!link) {
      throw new Error("No file links found in folder contents");
    }

    return link;
  }

  private static async parseLinksRecursively(
    id: string,
    password?: string
  ): Promise<string | null> {
    const params = new URLSearchParams({
      cache: "true",
      sortField: "createTime",
      sortDirection: "1",
    });

    if (password) {
      params.set("password", password);
    }

    const requestHeaders = {
      ...this.getBaseHeaders(this.token),
      "X-Website-Token": await this.generateWebsiteToken(this.token),
      "X-BL": this.language,
    };

    const response = await this.fetchWithTimeout(
      `https://api.gofile.io/contents/${id}?${params.toString()}`,
      {
        method: "GET",
        headers: requestHeaders,
      }
    );

    const payload =
      /** @type {{ status?: string; data?: GofileContentsResponse }} */ await response.json();

    if (payload.status === "error-rateLimit" || response.status === 429) {
      throw new Error(
        "RATE_LIMIT:Gofile rate limit reached. Please enable a VPN and try again in a few minutes."
      );
    }

    if (payload.status !== "ok" || !payload.data) {
      throw new Error(
        `Failed to get download link: ${payload.status ?? "unknown"}`
      );
    }

    if (payload.data.type === "file") {
      return payload.data.link ?? null;
    }

    if (payload.data.type !== "folder") {
      throw new Error("Unsupported content type");
    }

    const children = Object.values(
      payload.data.children ?? {}
    ) as GofileContentChild[];
    for (const child of children) {
      if (child.type === "file" && child.link) {
        return child.link;
      }
      if (child.type === "folder") {
        const nestedLink = await this.parseLinksRecursively(child.id, password);
        if (nestedLink) {
          return nestedLink;
        }
      }
    }

    return null;
  }

  public static async checkDownloadUrl(url: string) {
    const response = await this.fetchWithTimeout(url, {
      method: "HEAD",
      headers: {
        Cookie: `accountToken=${this.token}`,
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

    return response;
  }
}
