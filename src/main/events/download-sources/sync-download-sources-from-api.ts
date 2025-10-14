import { HydraApi } from "@main/services";
import { downloadSourcesSublevel } from "@main/level";
import { importDownloadSourceToLocal } from "./helpers";

export const syncDownloadSourcesFromApi = async () => {
  try {
    const apiSources = await HydraApi.get<
      { url: string; createdAt: string; updatedAt: string }[]
    >("/profile/download-sources");

    const localSources: { url: string }[] = [];
    for await (const [, source] of downloadSourcesSublevel.iterator()) {
      localSources.push(source);
    }

    const localUrls = new Set(localSources.map((s) => s.url));

    for (const apiSource of apiSources) {
      if (!localUrls.has(apiSource.url)) {
        await importDownloadSourceToLocal(apiSource.url, false);
      }
    }
  } catch (error) {
    console.error("Failed to sync download sources from API:", error);
  }
};
