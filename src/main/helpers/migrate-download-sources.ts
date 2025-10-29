import { downloadSourcesSublevel } from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { DownloadSource } from "@types";

export const migrateDownloadSources = async () => {
  const downloadSources = downloadSourcesSublevel.iterator();

  for await (const [key, value] of downloadSources) {
    if (!value.isRemote) {
      const downloadSource = await HydraApi.post<DownloadSource>(
        "/download-sources",
        {
          url: value.url,
        },
        { needsAuth: false }
      );

      await downloadSourcesSublevel.put(downloadSource.id, {
        ...downloadSource,
        isRemote: true,
        createdAt: new Date().toISOString(),
      });

      await downloadSourcesSublevel.del(key);
    }
  }
};
