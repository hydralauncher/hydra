import axios, { AxiosInstance } from "axios";
import type { AllDebridUser } from "@types";
import { logger } from "@main/services";

interface AllDebridMagnetStatus {
  id: number;
  filename: string;
  size: number;
  status: string;
  statusCode: number;
  downloaded: number;
  uploaded: number;
  seeders: number;
  downloadSpeed: number;
  uploadSpeed: number;
  uploadDate: number;
  completionDate: number;
  links: Array<{
    link: string;
    filename: string;
    size: number;
  }>;
}

interface AllDebridError {
  code: string;
  message: string;
}

interface AllDebridDownloadUrl {
  link: string;
  size?: number;
  filename?: string;
}

export class AllDebridClient {
  private static instance: AxiosInstance;
  private static readonly baseURL = "https://api.alldebrid.com/v4";

  static authorize(apiKey: string) {
    logger.info("[AllDebrid] Authorizing with key:", apiKey ? "***" : "empty");
    this.instance = axios.create({
      baseURL: this.baseURL,
      params: {
        agent: "hydra",
        apikey: apiKey,
      },
    });
  }

  static async getUser() {
    try {
      const response = await this.instance.get<{
        status: string;
        data?: { user: AllDebridUser };
        error?: AllDebridError;
      }>("/user");

      logger.info("[AllDebrid] API Response:", response.data);

      if (response.data.status === "error") {
        const error = response.data.error;
        logger.error("[AllDebrid] API Error:", error);
        if (error?.code === "AUTH_MISSING_APIKEY") {
          return { error_code: "alldebrid_missing_key" };
        }
        if (error?.code === "AUTH_BAD_APIKEY") {
          return { error_code: "alldebrid_invalid_key" };
        }
        if (error?.code === "AUTH_BLOCKED") {
          return { error_code: "alldebrid_blocked" };
        }
        if (error?.code === "AUTH_USER_BANNED") {
          return { error_code: "alldebrid_banned" };
        }
        return { error_code: "alldebrid_unknown_error" };
      }

      if (!response.data.data?.user) {
        logger.error("[AllDebrid] No user data in response");
        return { error_code: "alldebrid_invalid_response" };
      }

      logger.info(
        "[AllDebrid] Successfully got user:",
        response.data.data.user.username
      );
      return { user: response.data.data.user };
    } catch (error: any) {
      logger.error("[AllDebrid] Request Error:", error);
      if (error.response?.data?.error) {
        return { error_code: "alldebrid_invalid_key" };
      }
      return { error_code: "alldebrid_network_error" };
    }
  }

  private static async uploadMagnet(magnet: string) {
    try {
      logger.info("[AllDebrid] Uploading magnet with params:", { magnet });

      const response = await this.instance.get("/magnet/upload", {
        params: {
          magnets: [magnet],
        },
      });

      logger.info(
        "[AllDebrid] Upload Magnet Raw Response:",
        JSON.stringify(response.data, null, 2)
      );

      if (response.data.status === "error") {
        throw new Error(response.data.error?.message || "Unknown error");
      }

      const magnetInfo = response.data.data.magnets[0];
      logger.info(
        "[AllDebrid] Magnet Info:",
        JSON.stringify(magnetInfo, null, 2)
      );

      if (magnetInfo.error) {
        throw new Error(magnetInfo.error.message);
      }

      return magnetInfo.id;
    } catch (error: any) {
      logger.error("[AllDebrid] Upload Magnet Error:", error);
      throw error;
    }
  }

  private static async checkMagnetStatus(
    magnetId: number
  ): Promise<AllDebridMagnetStatus> {
    try {
      logger.info("[AllDebrid] Checking magnet status for ID:", magnetId);

      const response = await this.instance.get(`/magnet/status`, {
        params: {
          id: magnetId,
        },
      });

      logger.info(
        "[AllDebrid] Check Magnet Status Raw Response:",
        JSON.stringify(response.data, null, 2)
      );

      if (!response.data) {
        throw new Error("No response data received");
      }

      if (response.data.status === "error") {
        throw new Error(response.data.error?.message || "Unknown error");
      }

      // Verificăm noua structură a răspunsului
      const magnetData = response.data.data?.magnets;
      if (!magnetData || typeof magnetData !== "object") {
        logger.error(
          "[AllDebrid] Invalid response structure:",
          JSON.stringify(response.data, null, 2)
        );
        throw new Error("Invalid magnet status response format");
      }

      // Convertim răspunsul în formatul așteptat
      const magnetStatus: AllDebridMagnetStatus = {
        id: magnetData.id,
        filename: magnetData.filename,
        size: magnetData.size,
        status: magnetData.status,
        statusCode: magnetData.statusCode,
        downloaded: magnetData.downloaded,
        uploaded: magnetData.uploaded,
        seeders: magnetData.seeders,
        downloadSpeed: magnetData.downloadSpeed,
        uploadSpeed: magnetData.uploadSpeed,
        uploadDate: magnetData.uploadDate,
        completionDate: magnetData.completionDate,
        links: magnetData.links.map((link) => ({
          link: link.link,
          filename: link.filename,
          size: link.size,
        })),
      };

      logger.info(
        "[AllDebrid] Magnet Status:",
        JSON.stringify(magnetStatus, null, 2)
      );

      return magnetStatus;
    } catch (error: any) {
      logger.error("[AllDebrid] Check Magnet Status Error:", error);
      throw error;
    }
  }

  private static async unlockLink(link: string) {
    try {
      const response = await this.instance.get<{
        status: string;
        data?: { link: string };
        error?: AllDebridError;
      }>("/link/unlock", {
        params: {
          link,
        },
      });

      if (response.data.status === "error") {
        throw new Error(response.data.error?.message || "Unknown error");
      }

      const unlockedLink = response.data.data?.link;
      if (!unlockedLink) {
        throw new Error("No download link received from AllDebrid");
      }

      return unlockedLink;
    } catch (error: any) {
      logger.error("[AllDebrid] Unlock Link Error:", error);
      throw error;
    }
  }

  public static async getDownloadUrls(
    uri: string
  ): Promise<AllDebridDownloadUrl[]> {
    try {
      logger.info("[AllDebrid] Getting download URLs for URI:", uri);

      if (uri.startsWith("magnet:")) {
        logger.info("[AllDebrid] Detected magnet link, uploading...");
        // 1. Upload magnet
        const magnetId = await this.uploadMagnet(uri);
        logger.info("[AllDebrid] Magnet uploaded, ID:", magnetId);

        // 2. Verificăm statusul până când avem link-uri
        let retries = 0;
        let magnetStatus: AllDebridMagnetStatus;

        do {
          magnetStatus = await this.checkMagnetStatus(magnetId);
          logger.info(
            "[AllDebrid] Magnet status:",
            magnetStatus.status,
            "statusCode:",
            magnetStatus.statusCode
          );

          if (magnetStatus.statusCode === 4) {
            // Ready
            // Deblocăm fiecare link în parte și aruncăm eroare dacă oricare eșuează
            const unlockedLinks = await Promise.all(
              magnetStatus.links.map(async (link) => {
                try {
                  const unlockedLink = await this.unlockLink(link.link);
                  logger.info(
                    "[AllDebrid] Successfully unlocked link:",
                    unlockedLink
                  );

                  return {
                    link: unlockedLink,
                    size: link.size,
                    filename: link.filename,
                  };
                } catch (error) {
                  logger.error(
                    "[AllDebrid] Failed to unlock link:",
                    link.link,
                    error
                  );
                  throw new Error("Failed to unlock all links");
                }
              })
            );

            logger.info(
              "[AllDebrid] Got unlocked download links:",
              unlockedLinks
            );
            console.log("[AllDebrid] FINAL LINKS →", unlockedLinks);
            return unlockedLinks;
          }

          if (retries++ > 30) {
            // Maximum 30 de încercări
            throw new Error("Timeout waiting for magnet to be ready");
          }

          await new Promise((resolve) => setTimeout(resolve, 2000)); // Așteptăm 2 secunde între verificări
        } while (magnetStatus.statusCode !== 4);
      } else {
        logger.info("[AllDebrid] Regular link, unlocking...");
        // Pentru link-uri normale, doar debridam link-ul
        const downloadUrl = await this.unlockLink(uri);
        logger.info("[AllDebrid] Got unlocked download URL:", downloadUrl);
        return [
          {
            link: downloadUrl,
          },
        ];
      }
    } catch (error: any) {
      logger.error("[AllDebrid] Get Download URLs Error:", error);
      throw error;
    }
    return []; // Add default return for TypeScript
  }
}
