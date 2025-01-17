import axios, { AxiosResponse } from "axios";

export class DatanodesApi {
  private static readonly session = axios.create({});

  public static async getDownloadUrl(downloadUrl: string): Promise<string> {
    const parsedUrl = new URL(downloadUrl);
    const pathSegments = parsedUrl.pathname.split("/");

    const fileCode = decodeURIComponent(pathSegments[1]);
    const fileName = decodeURIComponent(pathSegments[pathSegments.length - 1]);

    const payload = new URLSearchParams({
      op: "download2",
      id: fileCode,
      rand: "",
      referer: "https://datanodes.to/download",
      method_free: "Free Download >>",
      method_premium: "",
      adblock_detected: "",
    });

    const response: AxiosResponse = await this.session.post(
      "https://datanodes.to/download",
      payload,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: `lang=english; file_name=${fileName}; file_code=${fileCode};`,
          Host: "datanodes.to",
          Origin: "https://datanodes.to",
          Referer: "https://datanodes.to/download",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
        maxRedirects: 0,
        validateStatus: (status: number) => status === 302 || status < 400,
      }
    );

    if (response.status === 302) {
      return response.headers["location"];
    }

    return "";
  }
}
