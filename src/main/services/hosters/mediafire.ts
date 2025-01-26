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
        validateStatus: (status: number) => status === 302 || status < 400,
      }
    );

    if (response.status === 302) {
      return response.headers["location"] || "";
    }

    const dom = new JSDOM(response.data);
    const downloadButton = dom.window.document.querySelector(
      "a#downloadButton"
    ) as HTMLAnchorElement;

    return downloadButton?.href || "";
  }
}
