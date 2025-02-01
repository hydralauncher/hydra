import fetch from "node-fetch";

export class MediafireApi {
  private static readonly corsProxy = "https://corsproxy.io/?";
  private static readonly validMediafireIdentifierDL = /^[a-zA-Z0-9]+$/m;
  private static readonly validMediafirePreDL =
    /(?<=['"])(https?:)?(\/\/)?(www\.)?mediafire\.com\/(file|view|download)\/[^'"?]+\?dkey=[^'"]+(?=['"])/;
  private static readonly validDynamicDL =
    /(?<=['"])https?:\/\/download[0-9]+\.mediafire\.com\/[^'"]+(?=['"])/;
  private static readonly checkHTTP = /^https?:\/\//m;

  public static async getDownloadUrl(mediafireUrl: string): Promise<string> {
    try {
      const processedUrl = this.processUrl(mediafireUrl);
      const response = await fetch(
        `${this.corsProxy}${encodeURIComponent(processedUrl)}`
      );

      if (!response.ok) throw new Error("Failed to fetch Mediafire page");

      const html = await response.text();
      return this.extractDirectUrl(html, processedUrl);
    } catch (error) {
      throw new Error(`Failed to get download URL: ${error.message}`);
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

  private static extractDirectUrl(html: string, _originalUrl: string): string {
    const preUrls = html.match(this.validMediafirePreDL);
    if (preUrls && preUrls[0]) {
      return preUrls[0];
    }

    const dlUrls = html.match(this.validDynamicDL);
    if (dlUrls && dlUrls[0]) {
      return dlUrls[0];
    }

    throw new Error("No valid download links found");
  }
}
