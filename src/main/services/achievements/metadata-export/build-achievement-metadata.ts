import path from "node:path";

import type { AchievementMetadataEntry, SteamAchievement } from "@types";

export const ACHIEVEMENT_IMAGES_DIR_NAME = "images";

const DEFAULT_ICON_EXTENSION = ".jpg";

const ALLOWED_ICON_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
]);

export interface AchievementIcon {
  fileName: string;
  url: string;
}

export interface AchievementMetadata {
  entries: AchievementMetadataEntry[];
  icons: AchievementIcon[];
}

const getIconExtension = (iconUrl: string) => {
  let extension: string;

  try {
    extension = path.posix.extname(new URL(iconUrl).pathname).toLowerCase();
  } catch {
    return DEFAULT_ICON_EXTENSION;
  }

  return ALLOWED_ICON_EXTENSIONS.has(extension)
    ? extension
    : DEFAULT_ICON_EXTENSION;
};

export const getAchievementIconUrls = (achievement: SteamAchievement) => {
  const icon = achievement.icon;

  const icongray = achievement.icongray?.endsWith("/")
    ? icon
    : achievement.icongray;

  return { icon, icongray: icongray || icon };
};

export const buildAchievementMetadata = (
  achievements: SteamAchievement[]
): AchievementMetadata => {
  const entries: AchievementMetadataEntry[] = [];
  const icons: AchievementIcon[] = [];

  for (const achievement of achievements.filter(({ name }) => Boolean(name))) {
    const { icon, icongray } = getAchievementIconUrls(achievement);

    const position = entries.length + 1;
    const iconFileName = `${position}${getIconExtension(icon)}`;
    const icongrayFileName = `${position}_gray${getIconExtension(icongray)}`;

    entries.push({
      description: achievement.description ?? "",
      displayName: achievement.displayName ?? achievement.name,
      hidden: achievement.hidden ? 1 : 0,
      icon: `${ACHIEVEMENT_IMAGES_DIR_NAME}/${iconFileName}`,
      icongray: `${ACHIEVEMENT_IMAGES_DIR_NAME}/${icongrayFileName}`,
      name: achievement.name,
    });

    icons.push(
      { fileName: iconFileName, url: icon },
      { fileName: icongrayFileName, url: icongray }
    );
  }

  return { entries, icons };
};
