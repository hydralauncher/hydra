import axios from "axios";

export class PixelDrainApi {
  public static canHandle(url: string): boolean {
    try {
      return new URL(url).hostname.includes("pixeldrain.com");
    } catch {
      return false;
    }
  }

  private static extractId(url: string): string {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`Invalid pixeldrain URL: ${url}`);
    }

    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    const id = pathParts[1];

    if (pathParts[0] !== "u" || !id) {
      throw new Error(`Invalid pixeldrain URL: ${url}`);
    }

    return id;
  }

  private static async checkAvailability(id: string): Promise<void> {
    const response = await axios.head(`https://pixeldrain.com/u/${id}`, {
      validateStatus: () => true,
    });

    if (response.status === 404) {
      throw new Error("File not found");
    }
  }

  public static async unlock(url: string): Promise<string> {
    try {
      const id = this.extractId(url);
      await this.checkAvailability(id);
      return `https://pixeldrain.com/api/file/${id}?download`;
    } catch (error) {
      console.error("Error fetching PixelDrain URL:", error);
      throw error;
    }
  }

  public static async getDownloadUrl(url: string): Promise<string> {
    return this.unlock(url);
  }
}
