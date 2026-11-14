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
  platform: NodeJS.Platform,
  hasNativeWindowDecorations = false
): RetroAchievementsConnectionWindowLayout => {
  const hasCustomTitleBar = platform === "linux" && !hasNativeWindowDecorations;

  return {
    width:
      AUTH_WINDOW_CONTENT_WIDTH +
      (hasCustomTitleBar ? CUSTOM_WINDOW_BORDER_WIDTH * 2 : 0),
    height:
      AUTH_WINDOW_CONTENT_HEIGHT +
      (hasCustomTitleBar
        ? CUSTOM_WINDOW_TITLE_BAR_HEIGHT + CUSTOM_WINDOW_BORDER_WIDTH * 2
        : 0),
    frame: !hasCustomTitleBar,
    minimizable: hasCustomTitleBar,
  };
};
