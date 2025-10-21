import { downloadSourcesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const getDownloadSources = async (_event: Electron.IpcMainInvokeEvent) => {
  return downloadSourcesSublevel.values().all();
};

registerEvent("getDownloadSources", getDownloadSources);
