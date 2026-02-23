import axios, { AxiosResponse } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { logger } from "@main/services";

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

      const formData = new FormData();
      formData.append("op", "download2");
      formData.append("id", fileCode);
      formData.append("rand", "");
      formData.append("referer", "https://datanodes.to/download");
      formData.append("method_free", "Free Download >>");
      formData.append("method_premium", "");
      formData.append("__dl", "1");
      formData.append("g_captch__a", "1");

      const response: AxiosResponse = await this.session.post(
        "https://datanodes.to/download",
        formData,
        {
          headers: {
            accept: "*/*",
            "accept-language": "en-US,en;q=0.9",
            priority: "u=1, i",
            "sec-ch-ua":
              '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            Referer: "https://datanodes.to/download",
          },
        }
      );

      if (typeof response.data === "object" && response.data.url) {
        return decodeURIComponent(response.data.url);
      }

      throw new Error("Failed to get the download link");
    } catch (error) {
      logger.error("Error fetching download URL:", error);
      throw error;
    }
  }
}
