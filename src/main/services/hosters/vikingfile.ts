import { HydraApi } from "../hydra-api";

interface UnlockResponse {
  link: string;
}

export class VikingFileApi {
  public static async getDownloadUrl(uri: string): Promise<string> {
    const response = await HydraApi.post<UnlockResponse>(
      "/hosters/vikingfile/unlock",
      { url: uri },
      { needsSubscription: true }
    );

    if (!response?.link) {
      throw new Error("Failed to unlock VikingFile URL");
    }

    return response.link;
  }
}
