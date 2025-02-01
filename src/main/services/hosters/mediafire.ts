import axios, { AxiosResponse } from "axios";
import { JSDOM } from "jsdom";

export class MediafireApi {
  private static readonly session = axios.create();

  public static async getDownloadUrl(mediafireUrl: string): Promise<string> {
    const response: AxiosResponse<string> = await this.session.get(
      mediafireUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
        maxRedirects: 0,
        validateStatus: (status: number) => status === 200 || status === 302,
      }
    );

    if (response.status === 302) {
      const location = response.headers["location"];
      if (!location) {
        throw new Error("Missing location header in 302 redirect response");
      }
      return location;
    }

    const dom = new JSDOM(response.data);
    const downloadButton = dom.window.document.querySelector(
      "a#downloadButton"
    ) as HTMLAnchorElement;

    if (!downloadButton?.href) {
      throw new Error("Download button URL not found in page content");
    }

    return downloadButton.href;
  }
}
