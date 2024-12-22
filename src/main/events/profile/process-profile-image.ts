import { registerEvent } from "../register-event";
import { PythonRPC } from "@main/services/python-rpc";

const processProfileImage = async (
  _event: Electron.IpcMainInvokeEvent,
  path: string
) => {
  return PythonRPC.rpc.post<{ imagePath: string; mimeType: string }>(
    "/profile_image_processor/process_image",
    { path }
  );
};

registerEvent("processProfileImage", processProfileImage);
