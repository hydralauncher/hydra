import axios from "axios";

export class FuckingFastApi {
  private static readonly FUCKINGFAST_DOMAINS = [
    "fuckingfast.co",
    "fuckingfast.net",
  ];

  private static readonly FUCKINGFAST_REGEX = /window\.open\("(https:\/\/fuckingfast\.(?:co|net)\/dl\/[^"]*)"\)/;

  /**
   * Checks if URL is from FuckingFast domain
   */
  private static isSupportedDomain(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return this.FUCKINGFAST_DOMAINS.some((domain) => lowerUrl.includes(domain));
  }

  /**
   * Extracts direct download link from FuckingFast URL
   */
  private static async getFuckingFastDirectLink(url: string): Promise<string> {
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
        },
        timeout: 30000,
      });

      const html = response.data;

      // Check for rate limit
      if (html.toLowerCase().includes("rate limit")) {
        throw new Error(
          "Rate limit exceeded. Please wait a few minutes and try again."
        );
      }

      // Check if file exists
      if (html.includes("File Not Found Or Deleted")) {
        throw new Error("File not found or deleted");
      }

      // Extract direct link using regex
      const match = this.FUCKINGFAST_REGEX.exec(html);
      if (!match || !match[1]) {
        throw new Error("Could not extract download link from page");
      }

      return match[1];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error("File not found");
        }
        if (error.response?.status === 429) {
          throw new Error("Rate limit exceeded. Please try again later.");
        }
        throw new Error(
          `Network error: ${error.response?.status || "Unknown"}`
        );
      }
      throw error;
    }
  }

  /**
   * Main method to get direct download link from FuckingFast URL
   * @param url - The FuckingFast URL
   * @returns Direct download URL
   */
  public static async getDirectLink(url: string): Promise<string> {
    if (!this.isSupportedDomain(url)) {
      throw new Error(
        `Unsupported domain. Supported domains: ${this.FUCKINGFAST_DOMAINS.join(", ")}`
      );
    }

    return this.getFuckingFastDirectLink(url);
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

