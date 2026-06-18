import axios, { AxiosError } from "axios";
import { logger } from "../logger";

interface RootzApiResponse {
  success: boolean;
  data?: {
    url: string | null;
    fileName: string;
    size: number;
    mimeType: string;
    expiresIn: number;
    expiresAt: string | null;
    downloads: number;
    canDelete: boolean;
    fileId: string;
    isMirrored: boolean;
    sourceService: string | null;
    isLayoutEnhanced?: boolean;
    status?: string;
    downloadAllowed?: boolean;
    isPremium?: boolean;
    isPublisher?: boolean;
    remainingDownloads?: number;
    passwordProtected?: boolean;
    isOwner?: boolean;
    ownerEmail?: string | null;
  };
  error?: string;
}

export class RootzApi {
  private static readonly baseUrl = "https://www.rootz.so";
  private static readonly userAgent =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  private static extractPageToken(html: string) {
    const match = /\\?"pageToken\\?"\s*:\s*\\?"([^"\\]+)/.exec(html);

    if (!match?.[1]) {
      throw new Error("Rootz page token not found");
    }

    return match[1];
  }

  public static async getDownloadUrl(uri: string): Promise<string> {
    try {
      const url = new URL(uri);
      const pathSegments = url.pathname.split("/").filter(Boolean);

      if (pathSegments.length < 2 || pathSegments[0] !== "d") {
        throw new Error("Invalid rootz URL format");
      }

      const id = pathSegments[1];
      const pageUrl = `${this.baseUrl}/d/${id}`;
      const apiUrl = `${this.baseUrl}/api/files/download-by-short?shortId=${encodeURIComponent(id)}`;

      const pageResponse = await axios.get<string>(pageUrl, {
        headers: {
          "User-Agent": this.userAgent,
          Accept: "text/html",
        },
      });

      const pageToken = this.extractPageToken(pageResponse.data);

      const response = await axios.get<RootzApiResponse>(apiUrl, {
        headers: {
          "User-Agent": this.userAgent,
          Accept: "application/json",
          Referer: pageUrl,
          "X-Page-Token": pageToken,
        },
      });

      const data = response.data.data;

      if (response.data.success && data?.fileId) {
        if (data.status && data.status !== "active") {
          throw new Error(`Rootz file is ${data.status}`);
        }

        if (data.downloadAllowed === false) {
          throw new Error("Rootz download is not allowed");
        }

        if (data.passwordProtected) {
          throw new Error("Rootz file is password protected");
        }

        return `${this.baseUrl}/api/files/proxy-download/${data.fileId}`;
      }

      throw new Error("Failed to get download URL from rootz API");
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<RootzApiResponse>;
        if (
          axiosError.response?.data?.error ||
          axiosError.response?.status === 404
        ) {
          const errorMessage =
            axiosError.response.data?.error || "File not found";
          logger.error(`[Rootz] ${errorMessage}`);
          throw new Error(errorMessage);
        }
      }

      logger.error("[Rootz] Error fetching download URL:", error);
      throw error;
    }
  }
}
