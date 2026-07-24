import { registerEvent } from "../register-event";
import { getActiveRetroArchImport } from "./retroarch-import-state";

const getActiveRetroArchImportHandler = async (
  _event: Electron.IpcMainInvokeEvent
) => getActiveRetroArchImport();

registerEvent("getActiveRetroArchImport", getActiveRetroArchImportHandler);
