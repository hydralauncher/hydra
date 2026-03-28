import axios from "axios";
import crypto from "node:crypto";

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

export class GofileApi {
  private static readonly defaultUserAgent = "Mozilla/5.0";
  private static readonly language = "en-US";
  private static readonly timeoutMs = 15000;
  private static token: string;

  private static get userAgent() {
    return process.env.GF_USERAGENT ?? this.defaultUserAgent;
  }

  private static generateWebsiteToken(accountToken: string) {
    const timeSlot = Math.floor(Date.now() / 1000 / 14400);
    const raw = `${this.userAgent}::${this.language}::${accountToken}::${timeSlot}::gf2026x`;
    return crypto.createHash("sha256").update(raw).digest("hex");
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

  public static async authorize() {
    const requestHeaders = {
      ...this.getBaseHeaders(),
      "X-Website-Token": this.generateWebsiteToken(""),
      "X-BL": this.language,
    };

    try {
      const response = await axios.post<{
        status: string;
        data: GofileAccountsReponse;
      }>("https://api.gofile.io/accounts", undefined, {
        headers: requestHeaders,
        timeout: this.timeoutMs,
      });

      if (response.data.status === "ok") {
        this.token = response.data.data.token;
        return this.token;
      }

      throw new Error(
        `Account creation failed: ${response.data.status ?? "unknown"}`
      );
    } catch (error) {
      if (axios.isAxiosError(error) && error.code === "ECONNABORTED") {
        throw new Error("Account creation timed out");
      }

      throw error;
    }
  }

  public static async getDownloadLink(id: string, password?: string) {
    const link = await this.parseLinksRecursively(id, password);
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
      "X-Website-Token": this.generateWebsiteToken(this.token),
      "X-BL": this.language,
    };

    const response = await axios.get<{
      status: string;
      data: GofileContentsResponse;
    }>(`https://api.gofile.io/contents/${id}?${params.toString()}`, {
      headers: requestHeaders,
      timeout: this.timeoutMs,
    });

    if (response.data.status !== "ok") {
      throw new Error("Failed to get download link");
    }

    if (response.data.data.type === "file") {
      return response.data.data.link ?? null;
    }

    if (response.data.data.type !== "folder") {
      throw new Error("Unsupported content type");
    }

    const children = Object.values(response.data.data.children ?? {});
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
    return axios.head(url, {
      headers: {
        Cookie: `accountToken=${this.token}`,
      },
    });
  }
}
