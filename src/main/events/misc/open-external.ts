import { shell } from "electron";
import { registerEvent } from "../register-event";
import { parseExternalUrl } from "@main/helpers/external-url";
import { logger } from "@main/services";

const openExternal = async (
  _event: Electron.IpcMainInvokeEvent,
  src: string
) => {
  const url = parseExternalUrl(src);

  if (!url) {
    logger.warn("Refused to open a non-web address externally", {
      src: String(src).slice(0, 200),
    });
    return;
  }

  await shell.openExternal(url);
};

registerEvent("openExternal", openExternal);
