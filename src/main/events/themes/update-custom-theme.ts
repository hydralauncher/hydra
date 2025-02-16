import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const updateCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  code: string
) => {
  const theme = await themesSublevel.get(themeId);

  if (!theme) {
    throw new Error("Theme not found");
  }

  await themesSublevel.put(themeId, {
    ...theme,
    code,
    updatedAt: new Date(),
  });
};

registerEvent("updateCustomTheme", updateCustomTheme);
