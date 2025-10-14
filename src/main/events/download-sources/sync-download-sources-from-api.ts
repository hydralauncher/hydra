import { HydraApi } from "@main/services";
import { importDownloadSourceToLocal, checkUrlExists } from "./helpers";

export const syncDownloadSourcesFromApi = async () => {
  try {
    const apiSources = await HydraApi.get<
      { url: string; createdAt: string; updatedAt: string }[]
    >("/profile/download-sources");

    for (const apiSource of apiSources) {
      const exists = await checkUrlExists(apiSource.url);
      if (!exists) {
        await importDownloadSourceToLocal(apiSource.url, false);
      }
    }
  } catch (error) {
    console.error("Failed to sync download sources from API:", error);
  }
};
