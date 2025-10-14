import { registerEvent } from "../register-event";
import { downloadSourcesSublevel, repacksSublevel } from "@main/level";

const deleteAllDownloadSources = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  await Promise.all([repacksSublevel.clear(), downloadSourcesSublevel.clear()]);
};

registerEvent("deleteAllDownloadSources", deleteAllDownloadSources);
