import { registerEvent } from "../register-event";
import { downloadSourcesSublevel, repacksSublevel } from "@main/level";
import { invalidateIdCaches } from "./helpers";

const deleteAllDownloadSources = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  await Promise.all([repacksSublevel.clear(), downloadSourcesSublevel.clear()]);

  invalidateIdCaches();
};

registerEvent("deleteAllDownloadSources", deleteAllDownloadSources);
