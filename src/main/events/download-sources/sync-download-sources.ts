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
    await downloadSourcesSublevel.put(downloadSource.id, downloadSource);
  }

  return response;
};

registerEvent("syncDownloadSources", syncDownloadSources);
