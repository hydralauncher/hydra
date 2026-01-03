import axios from "axios";
import https from "node:https";
import { logger } from "../logger";

interface UnlockResponse {
  link: string;
  hoster: string;
}

export class VikingFileApi {
  public static async getDownloadUrl(uri: string): Promise<string> {
    const unlockResponse = await axios.post<UnlockResponse>(
      `${import.meta.env.MAIN_VITE_NIMBUS_API_URL}/hosters/unlock`,
      { url: uri }
    );

    if (!unlockResponse.data.link) {
      throw new Error("Failed to unlock VikingFile URL");
    }

    const redirectUrl = unlockResponse.data.link;

    try {
      const redirectResponse = await axios.head(redirectUrl, {
        maxRedirects: 0,
        validateStatus: (status) =>
          status === 301 || status === 302 || status === 200,
      });

      if (
        redirectResponse.headers.location ||
        redirectResponse.status === 301 ||
        redirectResponse.status === 302
      ) {
        return redirectResponse.headers.location || redirectUrl;
      }

      return redirectUrl;
    } catch (error) {
      logger.error(
        `[VikingFile] Error following redirect, using redirect URL:`,
        error
      );
      return redirectUrl;
    }
  }
}
