import checkDiskSpace from "check-disk-space";

import { registerEvent } from "../register-event";

const getDiskFreeSpace = async (
  _event: Electron.IpcMainInvokeEvent,
  path: string
) => checkDiskSpace(path);

registerEvent(getDiskFreeSpace, {
  name: "getDiskFreeSpace",
});
