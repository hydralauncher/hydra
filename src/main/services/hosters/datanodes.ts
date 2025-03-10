import axios, { AxiosResponse } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";

export class DatanodesApi {
  private static readonly jar = new CookieJar();

  private static readonly session = wrapper(
    axios.create({
      jar: DatanodesApi.jar,
      withCredentials: true,
    })
  );

  public static async getDownloadUrl(downloadUrl: string): Promise<string> {
    try {
      const parsedUrl = new URL(downloadUrl);
      const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
      const fileCode = pathSegments[0];

      await this.jar.setCookie("lang=english;", "https://datanodes.to");

      const payload = new URLSearchParams({
        op: "download2",
        id: fileCode,
        method_free: "Free Download >>",
        dl: "1",
      });

      const response: AxiosResponse = await this.session.post(
        "https://datanodes.to/download",
        payload,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
            Referer: "https://datanodes.to/download",
            Origin: "https://datanodes.to",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          maxRedirects: 0,
          validateStatus: (status: number) => status === 302 || status < 400,
        }
      );

      if (response.status === 302) {
        return response.headers["location"];
      }

      if (typeof response.data === "object" && response.data.url) {
        return decodeURIComponent(response.data.url);
      }

      const htmlContent = String(response.data);
      if (!htmlContent) {
        throw new Error("Empty response received");
      }

      const downloadLinkRegex = /href=["'](https:\/\/[^"']+)["']/;
      const downloadLinkMatch = downloadLinkRegex.exec(htmlContent);
      if (downloadLinkMatch) {
        return downloadLinkMatch[1];
      }

      throw new Error("Failed to get the download link");
    } catch (error) {
      console.error("Error fetching download URL:", error);
      throw error;
    }
  }
}
