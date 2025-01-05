import disk from "diskusage";

import { registerEvent } from "../register-event";

const getDiskFreeSpace = async (
  _event: Electron.IpcMainInvokeEvent,
  path: string
) => disk.check(path);

registerEvent("getDiskFreeSpace", getDiskFreeSpace);
