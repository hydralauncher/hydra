import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

const removeDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  url?: string,
  removeAll = false
) => {
  const params = new URLSearchParams({
    all: removeAll.toString(),
  });

  if (url) params.set("url", url);

  return HydraApi.delete(`/profile/download-sources?${params.toString()}`);
};

registerEvent("removeDownloadSource", removeDownloadSource);
