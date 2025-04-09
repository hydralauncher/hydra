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

  public static getDownloadUrl(magnet: string) {
    try {
      return HydraApi.post("/debrid/request-file", {
        magnet,
      }).then((response) => response.downloadUrl);
    } catch (error) {
      return null;
    }
  }
}
