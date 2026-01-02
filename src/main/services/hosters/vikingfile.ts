import axios from "axios";
import https from "https";
import { logger } from "../logger";

interface UnlockResponse {
  link: string;
  hoster: string;
}

export class VikingFileApi {
  private static readonly browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Referer: "https://vikingfile.com/",
  };

  public static async getDownloadUrl(uri: string): Promise<string> {
    const unlockResponse = await axios.post<UnlockResponse>(
      `${import.meta.env.MAIN_VITE_NIMBUS_API_URL}/hosters/unlock`,
      { url: uri }
    );

    if (!unlockResponse.data.link) {
      throw new Error("Failed to unlock VikingFile URL");
    }

    const redirectUrl = unlockResponse.data.link;

    // Follow the redirect to get the final Cloudflare storage URL
    try {
      const redirectResponse = await axios.head(redirectUrl, {
        headers: this.browserHeaders,
        maxRedirects: 0,
        validateStatus: (status) =>
          status === 301 || status === 302 || status === 200,
        httpsAgent: new https.Agent({
          family: 4, // Force IPv4
        }),
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
