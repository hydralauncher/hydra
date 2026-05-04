import { clipboard } from "electron";
import { registerEvent } from "../register-event";

const clipboardWriteText = (
  _event: Electron.IpcMainInvokeEvent,
  text: string
) => {
  clipboard.writeText(text);
};

registerEvent("clipboardWriteText", clipboardWriteText);
