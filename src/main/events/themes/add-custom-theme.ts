import { Theme } from "@types";
import { themes } from "@main/level/sublevels/themes";
import { registerEvent } from "../register-event";

const addCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  theme: Theme
) => {
  await themes.put(theme.id, theme);
};

registerEvent("addCustomTheme", addCustomTheme);
