import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

const createDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  return HydraApi.post("/profile/download-sources", {
    url,
  });
};

registerEvent("createDownloadSource", createDownloadSource);
