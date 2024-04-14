import checkDiskSpace from "check-disk-space";

import { registerEvent } from "../register-event";
import { getDownloadsPath } from "../helpers/get-downloads-path";

const getDiskFreeSpace = async (_event: Electron.IpcMainInvokeEvent) =>
  checkDiskSpace(await getDownloadsPath());

registerEvent(getDiskFreeSpace, {
  name: "getDiskFreeSpace",
});
