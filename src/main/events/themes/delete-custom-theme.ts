import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const deleteCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string
) => {
  await themesSublevel.del(themeId);
};

registerEvent("deleteCustomTheme", deleteCustomTheme);
