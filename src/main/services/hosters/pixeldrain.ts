import axios from "axios";
import { logger } from "@main/services";

export class PixelDrainApi {
  private static readonly BYPASS_BASE_URL = "https://cdn.pixeldrain.eu.cc";
  private static readonly BYPASS_TIMEOUT_MS = 5000;

  public static canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.includes("pixeldrain.com");
    } catch {
      return false;
    }
  }

  private static extractId(url: string): string {
    const rawValue = url.trim();
    if (/^[a-zA-Z0-9_-]+$/.test(rawValue)) {
      return rawValue;
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`Invalid pixeldrain URL: ${url}`);
    }

    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    if (pathParts[0] === "u" && pathParts[1]) {
      return pathParts[1];
    }

    if (pathParts[0] === "api" && pathParts[1] === "file" && pathParts[2]) {
      return pathParts[2];
    }

    if (pathParts.length === 1 && /^[a-zA-Z0-9_-]+$/.test(pathParts[0])) {
      return pathParts[0];
    }

    throw new Error(`Invalid pixeldrain URL: ${url}`);
  }

  private static async checkAvailability(id: string): Promise<void> {
    const response = await axios.head(`https://pixeldrain.com/u/${id}`, {
      timeout: this.BYPASS_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (response.status === 404) {
      throw new Error("File not found");
    }
  }

  private static getBypassUrl(id: string): string {
    return `${this.BYPASS_BASE_URL}/${id}`;
  }

  private static async tryBypass(id: string): Promise<string | null> {
    const bypassUrl = this.getBypassUrl(id);

    try {
      const response = await axios.head(bypassUrl, {
        timeout: this.BYPASS_TIMEOUT_MS,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 400) {
        return bypassUrl;
      }

      logger.log(
        `[PixelDrain] Bypass HEAD returned status ${response.status}, falling back to API resolver.`
      );
      return null;
    } catch {
      logger.log(
        `[PixelDrain] Bypass HEAD failed, falling back to API resolver.`
      );
      return null;
    }
  }

  public static async unlock(url: string): Promise<string> {
    try {
      const id = this.extractId(url);
      const officialUrl = `https://pixeldrain.com/api/file/${id}?download`;

      try {
        await this.checkAvailability(id);
        return officialUrl;
      } catch (error) {
        if (error instanceof Error && error.message === "File not found") {
          throw error;
        }

        const bypassUrl = await this.tryBypass(id);
        if (bypassUrl) {
          return bypassUrl;
        }

        throw error;
      }
    } catch (error) {
      logger.error("Error fetching PixelDrain URL:", error);
      throw error;
    }
  }

  public static async getDownloadUrl(url: string): Promise<string> {
    return this.unlock(url);
  }
}
