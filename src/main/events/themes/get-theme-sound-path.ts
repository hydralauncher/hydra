import { registerEvent } from "../register-event";
import { getThemeSoundPath } from "@main/helpers";
import { themesSublevel } from "@main/level";

const getThemeSoundPathEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string
): Promise<string | null> => {
  const theme = await themesSublevel.get(themeId);
  return getThemeSoundPath(themeId, theme?.name);
};

registerEvent("getThemeSoundPath", getThemeSoundPathEvent);
