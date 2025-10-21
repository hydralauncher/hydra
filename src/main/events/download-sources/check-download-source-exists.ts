import { registerEvent } from "../register-event";
import { downloadSourcesSublevel } from "@main/level";

const checkDownloadSourceExists = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
): Promise<boolean> => {
  for await (const [, source] of downloadSourcesSublevel.iterator()) {
    if (source.url === url) {
      return true;
    }
  }

  return false;
};

registerEvent("checkDownloadSourceExists", checkDownloadSourceExists);
