import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";
import { downloadSourcesSublevel } from "@main/level";
import type { DownloadSource } from "@types";

const syncDownloadSources = async (_event: Electron.IpcMainInvokeEvent) => {
  const downloadSources = await downloadSourcesSublevel.values().all();

  const response = await HydraApi.post<DownloadSource[]>(
    "/download-sources/sync",
    {
      ids: downloadSources.map((downloadSource) => downloadSource.id),
    },
    { needsAuth: false }
  );

  for (const downloadSource of response) {
    const existingDownloadSource = downloadSources.find(
      (source) => source.id === downloadSource.id
    );

    await downloadSourcesSublevel.put(downloadSource.id, {
      ...existingDownloadSource,
      ...downloadSource,
    });
  }
};

registerEvent("syncDownloadSources", syncDownloadSources);
