import {
  AUTH_WINDOW_CONTENT_HEIGHT,
  AUTH_WINDOW_CONTENT_WIDTH,
  CUSTOM_WINDOW_BORDER_WIDTH,
  CUSTOM_WINDOW_TITLE_BAR_HEIGHT,
} from "../../shared/window-layout.js";

export interface RetroAchievementsConnectionWindowLayout {
  width: number;
  height: number;
  frame: boolean;
  minimizable: boolean;
}

export const getRetroAchievementsConnectionWindowLayout = (
  platform: NodeJS.Platform
): RetroAchievementsConnectionWindowLayout => {
  const isLinux = platform === "linux";

  return {
    width:
      AUTH_WINDOW_CONTENT_WIDTH +
      (isLinux ? CUSTOM_WINDOW_BORDER_WIDTH * 2 : 0),
    height:
      AUTH_WINDOW_CONTENT_HEIGHT +
      (isLinux
        ? CUSTOM_WINDOW_TITLE_BAR_HEIGHT + CUSTOM_WINDOW_BORDER_WIDTH * 2
        : 0),
    frame: !isLinux,
    minimizable: isLinux,
  };
};
