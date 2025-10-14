import { registerEvent } from "../register-event";
import { downloadSourcesSublevel, repacksSublevel } from "@main/level";
import { invalidateDownloadSourcesCache, invalidateIdCaches } from "./helpers";

const deleteAllDownloadSources = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  await Promise.all([repacksSublevel.clear(), downloadSourcesSublevel.clear()]);

  // Invalidate caches after clearing all sources
  invalidateDownloadSourcesCache();
  invalidateIdCaches();
};

registerEvent("deleteAllDownloadSources", deleteAllDownloadSources);
