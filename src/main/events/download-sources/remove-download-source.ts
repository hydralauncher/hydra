import { HydraApi, LocalDownloadSources } from "@main/services";
import { downloadSourcesSublevel, localDownloadsSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const removeDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  removeAll = false,
  downloadSourceId?: string
) => {
  const params = new URLSearchParams({
    all: removeAll.toString(),
  });

  if (downloadSourceId) params.set("downloadSourceId", downloadSourceId);

  if (HydraApi.isLoggedIn() && HydraApi.hasActiveSubscription()) {
    void HydraApi.delete(`/profile/download-sources?${params.toString()}`);
  }

  if (removeAll) {
    await downloadSourcesSublevel.clear();
  } else if (downloadSourceId) {
    await downloadSourcesSublevel.del(downloadSourceId);
  }

  // Clean up local (file-based) source data, if any.
  if (removeAll) {
    await localDownloadsSublevel.clear();
    await LocalDownloadSources.buildIndex();
  } else if (
    downloadSourceId &&
    (await localDownloadsSublevel.get(downloadSourceId))
  ) {
    await LocalDownloadSources.removeSource(downloadSourceId);
  }
};

registerEvent("removeDownloadSource", removeDownloadSource);
