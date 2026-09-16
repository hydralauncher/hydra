export interface RetroAchievementsConnectionWindowLayout {
  width: number;
  height: number;
  frame: boolean;
  minimizable: boolean;
}

export const getRetroAchievementsConnectionWindowLayout = (
  platform: NodeJS.Platform,
  contentWidth: number,
  contentHeight: number,
  linuxTitleBarHeight: number,
  linuxBorder: number
): RetroAchievementsConnectionWindowLayout => {
  const isLinux = platform === "linux";

  return {
    width: contentWidth + (isLinux ? linuxBorder * 2 : 0),
    height:
      contentHeight + (isLinux ? linuxTitleBarHeight + linuxBorder * 2 : 0),
    frame: !isLinux,
    minimizable: isLinux,
  };
};
