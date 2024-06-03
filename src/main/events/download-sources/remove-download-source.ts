import { downloadSourceRepository } from "@main/repository";
import { registerEvent } from "../register-event";
import { SearchEngine } from "@main/services";

const removeDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  id: number
) => {
  await downloadSourceRepository.delete(id);
  await SearchEngine.updateRepacks();
};

registerEvent("removeDownloadSource", removeDownloadSource);
