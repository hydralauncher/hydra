import fetch from "node-fetch";

export class MediafireApi {
  private static readonly corsProxy = "https://corsproxy.io/?";
  private static readonly validMediafireIdentifierDL = /^[a-zA-Z0-9]+$/m;
  private static readonly validMediafirePreDL =
    /(?<=['"])(https?:)?(\/\/)?(www\.)?mediafire\.com\/(file|view|download)\/[^'"?]+\?dkey=[^'"]+(?=['"])/;
  private static readonly validDynamicDL =
    /(?<=['"])https?:\/\/download\d+\.mediafire\.com\/[^'"]+(?=['"])/;
  private static readonly checkHTTP = /^https?:\/\//m;

  public static async getDownloadUrl(mediafireUrl: string): Promise<string> {
    try {
      const processedUrl = this.processUrl(mediafireUrl);
      const response = await fetch(
        `${this.corsProxy}${encodeURIComponent(processedUrl)}`
      );

      if (!response.ok) throw new Error("Failed to fetch Mediafire page");

      const html = await response.text();
      return this.extractDirectUrl(html);
    } catch (error) {
      throw new Error(`Failed to get download URL`);
    }
  }

  private static processUrl(url: string): string {
    let processed = url.replace("http://", "https://");

    if (this.validMediafireIdentifierDL.test(processed)) {
      processed = `https://mediafire.com/?${processed}`;
    }

    if (!this.checkHTTP.test(processed)) {
      processed = processed.startsWith("//")
        ? `https:${processed}`
        : `https://${processed}`;
    }

    return processed;
  }

  private static extractDirectUrl(html: string): string {
    const preMatch = this.validMediafirePreDL.exec(html);
    if (preMatch?.[0]) {
      return preMatch[0];
    }

    const dlMatch = this.validDynamicDL.exec(html);
    if (dlMatch?.[0]) {
      return dlMatch[0];
    }

    throw new Error("No valid download links found");
  }
}
