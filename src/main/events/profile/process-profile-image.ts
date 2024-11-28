import { registerEvent } from "../register-event";

const processProfileImage = async (
  _event: Electron.IpcMainInvokeEvent,
  path: string
) => {
  return path;
  // return PythonInstance.processProfileImage(path);
};

registerEvent("processProfileImage", processProfileImage);
