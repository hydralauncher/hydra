import { HydraApi, logger } from "../";
import { downloadSourcesSublevel } from "@main/level";
import type { DownloadSource } from "@types";

export const syncDownloadSourcesFromApi = async () => {
  if (!HydraApi.isLoggedIn() || !HydraApi.hasActiveSubscription()) {
    return;
  }

  try {
    const profileSources = await HydraApi.get<DownloadSource[]>(
      "/profile/download-sources"
    );

    const existingSources = await downloadSourcesSublevel.values().all();
    const existingUrls = new Set(existingSources.map((source) => source.url));

    for (const downloadSource of profileSources) {
      if (!existingUrls.has(downloadSource.url)) {
        try {
          await downloadSourcesSublevel.put(downloadSource.id, {
            ...downloadSource,
            isRemote: true,
            createdAt: new Date().toISOString(),
          });

          logger.log(
            `Synced download source from profile: ${downloadSource.url}`
          );
        } catch (error) {
          logger.error(
            `Failed to sync download source ${downloadSource.url}:`,
            error
          );
        }
      }
    }
  } catch (error) {
    logger.error("Failed to sync download sources from API:", error);
  }
};

