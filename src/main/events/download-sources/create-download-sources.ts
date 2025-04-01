import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

const createDownloadSources = async (
  _event: Electron.IpcMainInvokeEvent,
  urls: string[]
) => {
  await HydraApi.post("/profile/download-sources", {
    urls,
  });
};

registerEvent("createDownloadSources", createDownloadSources);
