import { registerEvent } from "../register-event";
import { getThemeSoundPath } from "@main/helpers";

const getThemeSoundPathEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string
): Promise<string | null> => {
  return getThemeSoundPath(themeId);
};

registerEvent("getThemeSoundPath", getThemeSoundPathEvent);

