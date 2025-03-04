import axios from "axios";

export class PixelDrainApi {
  private static readonly browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    DNT: "1",
    Connection: "keep-alive",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
  };

  public static async getDownloadUrl(fileId: string): Promise<string> {
    try {
      const response = await axios.get(`https://pd.cybar.xyz/${fileId}`, {
        headers: this.browserHeaders,
        maxRedirects: 0,
        validateStatus: (status) =>
          status === 301 || status === 302 || status === 200,
      });

      if (
        response.headers.location ||
        response.status === 301 ||
        response.status === 302
      ) {
        return response.headers.location;
      }

      throw new Error(`No redirect URL found (status: ${response.status})`);
    } catch (error) {
      console.error("Error fetching PixelDrain URL:", error);
      throw error;
    }
  }
}
