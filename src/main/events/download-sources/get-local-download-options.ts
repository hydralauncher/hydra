import { registerEvent } from "../register-event";
import { LocalDownloadSources } from "@main/services";
import type { GameRepack } from "@types";

const getLocalDownloadOptions = async (
  _event: Electron.IpcMainInvokeEvent,
  title: string
): Promise<GameRepack[]> => {
  return LocalDownloadSources.getOptionsForGame(title);
};

registerEvent("getLocalDownloadOptions", getLocalDownloadOptions);
