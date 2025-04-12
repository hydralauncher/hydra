import { HydraApi } from "../hydra-api";

export class HydraDebridClient {
  public static getAvailableMagnets(
    magnets: string[]
  ): Promise<Record<string, boolean>> {
    return HydraApi.put(
      "/debrid/check-availability",
      {
        magnets,
      },
      { needsAuth: false }
    );
  }

  public static async getDownloadUrl(magnet: string) {
    try {
      const response = await HydraApi.post("/debrid/request-file", {
        magnet,
      });

      return response.downloadUrl;
    } catch (error) {
      return null;
    }
  }
}
