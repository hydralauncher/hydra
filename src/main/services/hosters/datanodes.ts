import { HydraApi } from "../hydra-api";

interface UnlockResponse {
  link: string;
}

export class DatanodesApi {
  public static async getDownloadUrl(uri: string): Promise<string> {
    const response = await HydraApi.post<UnlockResponse>(
      "/hosters/datanodes/unlock",
      { url: uri }
    );

    if (!response?.link) {
      throw new Error("Failed to unlock Datanodes URL");
    }

    return response.link;
  }
}
