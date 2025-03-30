import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

const getDownloadSources = async (_event: Electron.IpcMainInvokeEvent) => {
  return HydraApi.get("/profile/download-sources");
};

registerEvent("getDownloadSources", getDownloadSources);
