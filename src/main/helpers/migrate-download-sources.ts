import { downloadSourcesSublevel } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { logger } from "@main/services";
import { summarizeNetworkError } from "@main/services/network-error-summary";
import { DownloadSource } from "@types";

const MIGRATION_REQUEST_TIMEOUT_MS = 30_000;

export const migrateDownloadSources = async () => {
  const downloadSources = downloadSourcesSublevel.iterator();

  for await (const [key, value] of downloadSources) {
    if (!value.isRemote) {
      try {
        const downloadSource = await HydraApi.post<DownloadSource>(
          "/download-sources",
          {
            url: value.url,
          },
          { needsAuth: false, timeout: MIGRATION_REQUEST_TIMEOUT_MS }
        );

        await downloadSourcesSublevel.put(downloadSource.id, {
          ...downloadSource,
          isRemote: true,
          createdAt: new Date().toISOString(),
        });

        await downloadSourcesSublevel.del(key);
      } catch (error) {
        logger.error(
          `Failed to migrate download source ${key}:`,
          summarizeNetworkError(error)
        );
      }
    }
  }
};
