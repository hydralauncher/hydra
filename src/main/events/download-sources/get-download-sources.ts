import { downloadSourcesSublevel } from "@main/level";
import { registerEvent } from "../register-event";
import { orderBy } from "lodash-es";

const getDownloadSources = async (_event: Electron.IpcMainInvokeEvent) => {
  const allSources = await downloadSourcesSublevel.values().all();
  return orderBy(allSources, "createdAt", "desc");
};

registerEvent("getDownloadSources", getDownloadSources);
