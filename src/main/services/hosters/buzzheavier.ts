import axios from "axios";
import {
  HOSTER_USER_AGENT,
  extractHosterFilename,
  handleHosterError,
} from "./fuckingfast";
import { logger } from "@main/services";

export class BuzzheavierApi {
  private static readonly BUZZHEAVIER_DOMAINS = [
    "buzzheavier.com",
    "bzzhr.co",
    "fuckingfast.net",
  ];

  private static isSupportedDomain(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return this.BUZZHEAVIER_DOMAINS.some((domain) => lowerUrl.includes(domain));
  }

  private static async getBuzzheavierDirectLink(url: string): Promise<string> {
    try {
      const baseUrl = url.split("#")[0];
      logger.log(
        `[Buzzheavier] Starting download link extraction for: ${baseUrl}`
      );

      await axios.get(baseUrl, {
        headers: { "User-Agent": HOSTER_USER_AGENT },
        timeout: 30000,
      });

      const downloadUrl = `${baseUrl}/download`;
      logger.log(`[Buzzheavier] Making HEAD request to: ${downloadUrl}`);
      const headResponse = await axios.head(downloadUrl, {
        headers: {
          "hx-current-url": baseUrl,
          "hx-request": "true",
          referer: baseUrl,
          "User-Agent": HOSTER_USER_AGENT,
        },
        maxRedirects: 0,
        validateStatus: (status) =>
          status === 200 || status === 204 || status === 301 || status === 302,
        timeout: 30000,
      });

      const hxRedirect = headResponse.headers["hx-redirect"];
      logger.log(`[Buzzheavier] Received hx-redirect header: ${hxRedirect}`);
      if (!hxRedirect) {
        logger.error(
          `[Buzzheavier] No hx-redirect header found. Status: ${headResponse.status}`
        );
        throw new Error(
          "Could not extract download link. File may be deleted or is a directory."
        );
      }

      const domain = new URL(baseUrl).hostname;
      const directLink = hxRedirect.startsWith("/dl/")
        ? `https://${domain}${hxRedirect}`
        : hxRedirect;
      logger.log(`[Buzzheavier] Extracted direct link`);
      return directLink;
    } catch (error) {
      logger.error(`[Buzzheavier] Error in getBuzzheavierDirectLink:`, error);
      handleHosterError(error);
    }
  }

  public static async getDirectLink(url: string): Promise<string> {
    if (!this.isSupportedDomain(url)) {
      throw new Error(
        `Unsupported domain. Supported domains: ${this.BUZZHEAVIER_DOMAINS.join(", ")}`
      );
    }
    return this.getBuzzheavierDirectLink(url);
  }

  public static async getFilename(
    url: string,
    directUrl?: string
  ): Promise<string> {
    return extractHosterFilename(url, directUrl);
  }
}
