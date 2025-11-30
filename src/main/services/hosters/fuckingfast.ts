import axios from "axios";
import { logger } from "@main/services";

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
      logger.error(`[FuckingFast] Starting download link extraction for: ${url}`);
      const response = await axios.get(url, {
        headers: { "User-Agent": HOSTER_USER_AGENT },
        timeout: 30000,
      });

      const html = response.data;
      logger.error(`[FuckingFast] Received HTML response, length: ${html.length}`);

      if (html.toLowerCase().includes("rate limit")) {
        logger.error(`[FuckingFast] Rate limit detected in response`);
        throw new Error(
          "Rate limit exceeded. Please wait a few minutes and try again."
        );
      }

      if (html.includes("File Not Found Or Deleted")) {
        logger.error(`[FuckingFast] File not found or deleted`);
        throw new Error("File not found or deleted");
      }

      const match = this.FUCKINGFAST_REGEX.exec(html);
      logger.error(`[FuckingFast] Regex match result:`, match ? match[1] : "No match");
      if (!match || !match[1]) {
        logger.error(`[FuckingFast] Could not extract download link. HTML snippet:`, html.substring(0, 500));
        throw new Error("Could not extract download link from page");
      }

      logger.error(`[FuckingFast] Extracted direct link: ${match[1]}`);
      return match[1];
    } catch (error) {
      logger.error(`[FuckingFast] Error in getFuckingFastDirectLink:`, error);
      handleHosterError(error);
    }
  }

  public static async getDirectLink(url: string): Promise<string> {
    logger.error(`[FuckingFast] getDirectLink called with URL: ${url}`);
    if (!this.isSupportedDomain(url)) {
      logger.error(`[FuckingFast] Unsupported domain: ${url}. Supported: ${this.FUCKINGFAST_DOMAINS.join(", ")}`);
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

// Shared utilities for hosters
export const HOSTER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

export async function extractHosterFilename(
  url: string,
  directUrl?: string
): Promise<string> {
  // Try to get filename from fragment (#)
  if (url.includes("#")) {
    const fragment = url.split("#")[1];
    if (fragment && !fragment.startsWith("http")) {
      return fragment;
    }
  }

  // Try to get filename from direct URL
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
      // Ignore errors, fallback to URL parsing
    }

    // Extract from URL path
    const urlPath = new URL(directUrl).pathname;
    const filename = urlPath.split("/").pop()?.split("?")[0];
    if (filename) {
      return filename;
    }
  }

  return "downloaded_file";
}

export function handleHosterError(error: unknown): never {
  logger.error(`[HosterError] Handling hoster error:`, error);
  if (axios.isAxiosError(error)) {
    logger.error(`[HosterError] Axios error - Status: ${error.response?.status}, URL: ${error.config?.url}`);
    if (error.response?.status === 404) {
      logger.error(`[HosterError] 404 - File not found`);
      throw new Error("File not found");
    }
    if (error.response?.status === 429) {
      logger.error(`[HosterError] 429 - Rate limit exceeded`);
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    if (error.response?.status === 403) {
      logger.error(`[HosterError] 403 - Access denied`);
      throw new Error("Access denied. File may be private or deleted.");
    }
    logger.error(`[HosterError] Network error: ${error.response?.status || "Unknown"}`);
    throw new Error(`Network error: ${error.response?.status || "Unknown"}`);
  }
  logger.error(`[HosterError] Non-axios error, rethrowing:`, error);
  throw error;
}
