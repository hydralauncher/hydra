import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const toggleRetroArchSubfolders = async (
  _event: Electron.IpcMainInvokeEvent,
  folderId: string,
  scanSubfolders: boolean
) => {
  return retroarch.updateRetroArchConfig((current) => ({
    ...current,
    romFolders: current.romFolders.map((f) =>
      f.id === folderId ? { ...f, scanSubfolders } : f
    ),
  }));
};

registerEvent("toggleRetroArchSubfolders", toggleRetroArchSubfolders);
