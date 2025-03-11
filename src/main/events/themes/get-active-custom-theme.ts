import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const getActiveCustomTheme = async () => {
  const allThemes = await themesSublevel.values().all();
  return allThemes.find((theme) => theme.isActive);
};

registerEvent("getActiveCustomTheme", getActiveCustomTheme);
