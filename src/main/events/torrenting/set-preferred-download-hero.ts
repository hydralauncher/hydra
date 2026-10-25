import { downloadsSublevel } from "@main/level";
import { setPreferredDownloadHero, WindowManager } from "@main/services";
import { isActiveLikeDownload } from "../../../types";
import { registerEvent } from "../register-event";

const setPreferredDownloadHeroEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  downloadId: string | null
) => {
  if (downloadId !== null) {
    if (typeof downloadId !== "string") return;
    const download = await downloadsSublevel.get(downloadId).catch(() => null);
    if (!download || !isActiveLikeDownload(download)) return;
  }
  const layout = await setPreferredDownloadHero(downloadId);
  WindowManager.sendDownloadsUpdated();
  return layout;
};

registerEvent("setPreferredDownloadHero", setPreferredDownloadHeroEvent);
