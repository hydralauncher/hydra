import { downloadSourceRepository } from "@main/repository";
import { registerEvent } from "../register-event";
import { RepacksManager } from "@main/services";

const removeDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  id: number
) => downloadSourceRepository.delete(id);

registerEvent("removeDownloadSource", removeDownloadSource);
