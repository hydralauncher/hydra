import { registerEvent } from "../register-event";
import { PythonInstance } from "@main/services";

const processProfileImage = async (
  _event: Electron.IpcMainInvokeEvent,
  path: string
) => {
  return PythonInstance.processProfileImage(path);
};

registerEvent("processProfileImage", processProfileImage);
