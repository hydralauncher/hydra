import axios, { AxiosError } from "axios";
import { logger } from "../logger";

interface RootzApiResponse {
  success: boolean;
  data?: {
    url: string;
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
    adsEnabled: boolean;
  };
  error?: string;
}

export class RootzApi {
  public static async getDownloadUrl(uri: string): Promise<string> {
    try {
      const url = new URL(uri);
      const pathSegments = url.pathname.split("/").filter(Boolean);

      if (pathSegments.length < 2 || pathSegments[0] !== "d") {
        throw new Error("Invalid rootz URL format");
      }

      const id = pathSegments[1];
      const apiUrl = `https://www.rootz.so/api/files/download-by-short/${id}`;

      const response = await axios.get<RootzApiResponse>(apiUrl);

      if (response.data.success && response.data.data?.url) {
        return response.data.data.url;
      }

      throw new Error("Failed to get download URL from rootz API");
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<RootzApiResponse>;
        if (axiosError.response?.status === 404) {
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
