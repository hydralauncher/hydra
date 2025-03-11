import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const toggleCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  isActive: boolean
) => {
  const theme = await themesSublevel.get(themeId);

  if (!theme) {
    throw new Error("Theme not found");
  }

  await themesSublevel.put(themeId, {
    ...theme,
    isActive,
    updatedAt: new Date(),
  });
};

registerEvent("toggleCustomTheme", toggleCustomTheme);
