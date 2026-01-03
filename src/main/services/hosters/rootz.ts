import axios from "axios";
import {
  HOSTER_USER_AGENT,
  extractHosterFilename,
  handleHosterError,
} from "./fuckingfast";
import { logger } from "@main/services";

export class RootzApi {
  private static readonly ROOTZ_DOMAINS = ["rootz.so"];

  private static isSupportedDomain(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return this.ROOTZ_DOMAINS.some((domain) => lowerUrl.includes(domain));
  }

  private static extractShortId(url: string): string | null {
    const match = /\/d\/([a-zA-Z0-9]+)/.exec(url);
    return match ? match[1] : null;
  }

  private static async getRootzDirectLink(url: string): Promise<string> {
    try {
      const shortId = this.extractShortId(url);
      if (!shortId) {
        logger.error(`[Rootz] Could not extract ID from URL: ${url}`);
        throw new Error("Could not extract file ID from URL");
      }

      const apiUrl = `https://www.rootz.so/api/files/proxy-download/${shortId}`;
      logger.log(`[Rootz] Starting download link extraction for ID: ${shortId}`);

      const response = await axios.get(apiUrl, {
        headers: {
          "User-Agent": HOSTER_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3",
          Referer: `https://www.rootz.so/d/${shortId}`,
          Connection: "keep-alive",
        },
        maxRedirects: 0,
        validateStatus: (status) => status === 302,
        timeout: 30000,
      });

      const directLink = response.headers["location"];
      if (!directLink) {
        logger.error(`[Rootz] No Location header found. Status: ${response.status}`);
        throw new Error("Could not extract download link. File may be deleted.");
      }

      logger.log(`[Rootz] Successfully extracted direct link`);
      return directLink;
    } catch (error) {
      logger.error(`[Rootz] Error in getRootzDirectLink:`, error);
      handleHosterError(error);
    }
  }

  public static async getDirectLink(url: string): Promise<string> {
    if (!this.isSupportedDomain(url)) {
      throw new Error(
        `Unsupported domain. Supported domains: ${this.ROOTZ_DOMAINS.join(", ")}`
      );
    }
    return this.getRootzDirectLink(url);
  }

  public static async getFilename(
    url: string,
    directUrl?: string
  ): Promise<string> {
    return extractHosterFilename(url, directUrl);
  }
}
