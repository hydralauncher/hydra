import { registerEvent } from "../register-event";
import { getThemeSoundPath } from "@main/helpers";
import { themesSublevel } from "@main/level";
import type { AchievementNotificationVariation } from "@types";

const getThemeSoundPathEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  variation?: AchievementNotificationVariation
): Promise<string | null> => {
  const theme = await themesSublevel.get(themeId);
  return getThemeSoundPath(themeId, theme?.name, variation);
};

registerEvent("getThemeSoundPath", getThemeSoundPathEvent);
