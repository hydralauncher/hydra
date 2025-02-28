import { Theme } from "@types";
import { registerEvent } from "../register-event";
import { themesSublevel } from "@main/level";

const addCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  theme: Theme
) => {
  await themesSublevel.put(theme.id, theme);
};

registerEvent("addCustomTheme", addCustomTheme);
