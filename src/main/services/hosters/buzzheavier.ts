import axios from "axios";

export class BuzzheavierApi {
  private static readonly BUZZHEAVIER_DOMAINS = ["buzzheavier.com", "bzzhr.co"];

  /**
   * Checks if URL is from Buzzheavier domain
   */
  private static isSupportedDomain(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return this.BUZZHEAVIER_DOMAINS.some((domain) => lowerUrl.includes(domain));
  }

  /**
   * Extracts direct download link from Buzzheavier URL
   */
  private static async getBuzzheavierDirectLink(url: string): Promise<string> {
    try {
      // Remove fragment from URL
      const baseUrl = url.split("#")[0];

      // First, get the page to ensure file exists
      await axios.get(baseUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
        },
        timeout: 30000,
      });

      // Make HEAD request to /download with special headers
      const downloadUrl = `${baseUrl}/download`;
      const headResponse = await axios.head(downloadUrl, {
        headers: {
          "hx-current-url": baseUrl,
          "hx-request": "true",
          referer: baseUrl,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
        },
        maxRedirects: 0,
        validateStatus: (status) =>
          status === 200 || status === 204 || status === 301 || status === 302,
        timeout: 30000,
      });

      // Get hx-redirect header
      const hxRedirect = headResponse.headers["hx-redirect"];

      if (!hxRedirect) {
        throw new Error(
          "Could not extract download link. File may be deleted or is a directory."
        );
      }

      // Build final URL
      const domain = new URL(baseUrl).hostname;
      const directUrl = hxRedirect.startsWith("/dl/")
        ? `https://${domain}${hxRedirect}`
        : hxRedirect;

      return directUrl;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error("File not found");
        }
        if (error.response?.status === 403) {
          throw new Error("Access denied. File may be private or deleted.");
        }
        throw new Error(
          `Network error: ${error.response?.status || "Unknown"}`
        );
      }
      throw error;
    }
  }

  /**
   * Main method to get direct download link from Buzzheavier URL
   * @param url - The Buzzheavier URL
   * @returns Direct download URL
   */
  public static async getDirectLink(url: string): Promise<string> {
    if (!this.isSupportedDomain(url)) {
      throw new Error(
        `Unsupported domain. Supported domains: ${this.BUZZHEAVIER_DOMAINS.join(", ")}`
      );
    }

    return this.getBuzzheavierDirectLink(url);
  }

  /**
   * Extracts filename from URL
   * @param url - Original URL (may contain filename in fragment)
   * @param directUrl - Direct download URL
   * @returns Extracted filename
   */
  public static async getFilename(
    url: string,
    directUrl?: string
  ): Promise<string> {
    // Try to get filename from fragment (#)
    if (url.includes("#")) {
      const fragment = url.split("#")[1];
      if (fragment && !fragment.startsWith("http")) {
        return fragment;
      }
    }

    // Try to get filename from direct URL
    if (directUrl) {
      try {
        // Try content-disposition header
        const response = await axios.head(directUrl, {
          timeout: 10000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
          },
        });

        const contentDisposition = response.headers["content-disposition"];
        if (contentDisposition) {
          const filenameMatch = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
            contentDisposition
          );
          if (filenameMatch && filenameMatch[1]) {
            return filenameMatch[1].replace(/['"]/g, "");
          }
        }
      } catch (error) {
        // Ignore errors, fallback to URL parsing
      }

      // Extract from URL path
      const urlPath = new URL(directUrl).pathname;
      const filename = urlPath.split("/").pop()?.split("?")[0];
      if (filename) {
        return filename;
      }
    }

    return "downloaded_file";
  }
}
