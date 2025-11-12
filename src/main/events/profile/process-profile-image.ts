import { registerEvent } from "../register-event";
import { PythonRPC } from "@main/services/python-rpc";

const processProfileImageEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  path: string
) => {
  return processProfileImage(path, "webp");
};

export const processProfileImage = async (path: string, extension?: string) => {
  return PythonRPC.rpc
    .post<{
      imagePath: string;
      mimeType: string;
    }>("/profile-image", { image_path: path, target_extension: extension })
    .then((response) => response.data);
};

registerEvent("processProfileImage", processProfileImageEvent);
