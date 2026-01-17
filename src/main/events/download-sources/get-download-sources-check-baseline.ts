import { getDownloadSourcesCheckBaseline } from "@main/level";
import { registerEvent } from "../register-event";

const getDownloadSourcesCheckBaselineHandler = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  return await getDownloadSourcesCheckBaseline();
};

registerEvent(
  "getDownloadSourcesCheckBaseline",
  getDownloadSourcesCheckBaselineHandler
);
