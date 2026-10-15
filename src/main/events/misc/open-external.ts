import { shell } from "electron";
import { registerEvent } from "../register-event";
import { parseExternalUrl } from "@main/helpers/external-url";
import { logger } from "@main/services";

const LOGGED_ADDRESS_MAX_LENGTH = 200;

const openExternal = async (
  _event: Electron.IpcMainInvokeEvent,
  src: string
) => {
  const url = parseExternalUrl(src);

  if (!url) {
    logger.warn("Refused to open a non-web address externally", {
      src: String(src).slice(0, LOGGED_ADDRESS_MAX_LENGTH),
    });
    return;
  }

  await shell.openExternal(url);
};

registerEvent("openExternal", openExternal);
