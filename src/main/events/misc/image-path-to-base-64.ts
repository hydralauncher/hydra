import mime from "mime";
import { registerEvent } from "../register-event";
import fs from "node:fs";

const imagePathToBase64 = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
) => {
  const buffer = fs.readFileSync(filePath);
  const mimeType = mime.getType(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
};

registerEvent("imagePathToBase64", imagePathToBase64);
