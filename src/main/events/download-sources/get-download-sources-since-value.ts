import { getDownloadSourcesSinceValue } from "@main/level";
import { registerEvent } from "../register-event";

const getDownloadSourcesSinceValueHandler = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  return await getDownloadSourcesSinceValue();
};

registerEvent(
  "getDownloadSourcesSinceValue",
  getDownloadSourcesSinceValueHandler
);
