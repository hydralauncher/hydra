import { PythonRPC } from "../python-rpc";
import { logger } from "../logger";

interface FichierDownloadInfo {
  url: string;
  filename: string;
  cookies: Record<string, string>;
  headers: Record<string, string>;
  referer: string;
}

export class FichierApi {
  public static async getDownloadInfo(url: string): Promise<{
    url: string;
    header: string;
    referer: string;
  }> {
    try {
      const response = await PythonRPC.rpc.post<FichierDownloadInfo>(
        "/fichier/get-download-info",
        { url }
      );

      if (!response.data || !response.data.url) {
        throw new Error("Failed to get direct download link from 1fichier");
      }

      const cookieString = Object.entries(response.data.cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");

      const headerString = `Cookie: ${cookieString}\nReferer: ${response.data.referer}`;

      return {
        url: response.data.url,
        header: headerString,
        referer: response.data.referer,
      };
    } catch (error) {
      logger.error("Failed to get 1fichier download info", error);
      throw new Error("Failed to get direct download link from 1fichier");
    }
  }
}
