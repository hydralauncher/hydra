import axios from "axios";
import { logger } from "@main/services";

export const HOSTER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

export async function extractHosterFilename(
  url: string,
  directUrl?: string
): Promise<string> {
  if (url.includes("#")) {
    const fragment = url.split("#")[1];
    if (fragment && !fragment.startsWith("http")) {
      return fragment;
    }
  }

  if (directUrl) {
    try {
      const response = await axios.head(directUrl, {
        timeout: 10000,
        headers: { "User-Agent": HOSTER_USER_AGENT },
      });

      const contentDisposition = response.headers["content-disposition"];
      if (contentDisposition) {
        const filenameMatch = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
          contentDisposition
        );
        if (filenameMatch && filenameMatch[1]) {
          return filenameMatch[1].replace(/['"]/g, "");
        }
      }
    } catch {
      // Ignore errors
    }

    const urlPath = new URL(directUrl).pathname;
    const filename = urlPath.split("/").pop()?.split("?")[0];
    if (filename) {
      return filename;
    }
  }

  return "downloaded_file";
}

export function handleHosterError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 404) {
      throw new Error("File not found");
    }
    if (error.response?.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    if (error.response?.status === 403) {
      throw new Error("Access denied. File may be private or deleted.");
    }
    throw new Error(`Network error: ${error.response?.status || "Unknown"}`);
  }
  throw error;
}

// ============================================
// FuckingFast API Class
// ============================================
export class FuckingFastApi {
  private static readonly FUCKINGFAST_DOMAINS = ["fuckingfast.co"];

  private static readonly FUCKINGFAST_REGEX =
    /window\.open\("(https:\/\/fuckingfast\.co\/dl\/[^"]*)"\)/;

  private static isSupportedDomain(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return this.FUCKINGFAST_DOMAINS.some((domain) => lowerUrl.includes(domain));
  }

  private static async getFuckingFastDirectLink(url: string): Promise<string> {
    try {
      logger.log(`[FuckingFast] Starting download link extraction for: ${url}`);
      const response = await axios.get(url, {
        headers: { "User-Agent": HOSTER_USER_AGENT },
        timeout: 30000,
      });

      const html = response.data;

      if (html.toLowerCase().includes("rate limit")) {
        logger.error(`[FuckingFast] Rate limit detected`);
        throw new Error(
          "Rate limit exceeded. Please wait a few minutes and try again."
        );
      }

      if (html.includes("File Not Found Or Deleted")) {
        logger.error(`[FuckingFast] File not found or deleted`);
        throw new Error("File not found or deleted");
      }

      const match = this.FUCKINGFAST_REGEX.exec(html);
      if (!match || !match[1]) {
        logger.error(`[FuckingFast] Could not extract download link`);
        throw new Error("Could not extract download link from page");
      }

      logger.log(`[FuckingFast] Successfully extracted direct link`);
      return match[1];
    } catch (error) {
      logger.error(`[FuckingFast] Error:`, error);
      handleHosterError(error);
    }
  }

  public static async getDirectLink(url: string): Promise<string> {
    if (!this.isSupportedDomain(url)) {
      throw new Error(
        `Unsupported domain. Supported domains: ${this.FUCKINGFAST_DOMAINS.join(", ")}`
      );
    }
    return this.getFuckingFastDirectLink(url);
  }

  public static async getFilename(
    url: string,
    directUrl?: string
  ): Promise<string> {
    return extractHosterFilename(url, directUrl);
  }
}
