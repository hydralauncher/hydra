import { registerEvent } from "../register-event";
import { fetchDownloadSourcesAndUpdate } from "@main/helpers";

const syncDownloadSources = async (_event: Electron.IpcMainInvokeEvent) =>
  fetchDownloadSourcesAndUpdate();

registerEvent("syncDownloadSources", syncDownloadSources);
