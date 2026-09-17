import axios from "axios";
import { DownloadError } from "@shared";
import { logger } from "@main/services";

interface PixelDrainFileInfo {
  availability?: string;
  can_download?: boolean;
}

export class PixelDrainApi {
  private static readonly API_BASE_URL = "https://pixeldrain.com/api/file";

  public static canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.includes("pixeldrain.com");
    } catch {
      return false;
    }
  }

  private static extractId(url: string): string {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`Invalid pixeldrain URL: ${url}`);
    }

    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    const id = pathParts[1];

    if (pathParts[0] !== "u" || !id) {
      throw new Error(`Invalid pixeldrain URL: ${url}`);
    }

    return id;
  }

  private static async checkAvailability(id: string): Promise<void> {
    const response = await axios.get<PixelDrainFileInfo>(
      `${this.API_BASE_URL}/${id}/info`,
      { validateStatus: () => true }
    );

    if (response.status === 404) {
      throw new Error(DownloadError.HosterUnlockFileNotFound);
    }

    if (
      response.status >= 400 ||
      response.data?.availability ||
      response.data?.can_download === false
    ) {
      logger.warn(
        `[PixelDrain] File ${id} is not downloadable (status=${response.status}, availability=${response.data?.availability ?? "none"})`
      );
      throw new Error(DownloadError.HosterUnlockUnavailable);
    }
  }

  public static async unlock(url: string): Promise<string> {
    try {
      const id = this.extractId(url);
      await this.checkAvailability(id);
      return `${this.API_BASE_URL}/${id}?download`;
    } catch (error) {
      logger.error("Error fetching PixelDrain URL:", error);
      throw error;
    }
  }

  public static async getDownloadUrl(url: string): Promise<string> {
    return this.unlock(url);
  }
}
