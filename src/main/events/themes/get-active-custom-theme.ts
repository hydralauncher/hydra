import { registerEvent } from "../register-event";
import { themes } from "@main/level/sublevels/themes";
import { Theme } from "@types";

const getActiveCustomTheme = async () => {
  const allThemes = await themes.values().all();
  return allThemes.find((theme: Theme) => theme.isActive);
};

registerEvent("getActiveCustomTheme", getActiveCustomTheme);
