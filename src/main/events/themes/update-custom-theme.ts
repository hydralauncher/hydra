import { themes } from "@main/level/sublevels/themes";
import { registerEvent } from "../register-event";
import { Theme } from "@types";

const updateCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  theme: Theme
) => {
  await themes.put(themeId, theme);
};

registerEvent("updateCustomTheme", updateCustomTheme);
