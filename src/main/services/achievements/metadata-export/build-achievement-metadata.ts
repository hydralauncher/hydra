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

/**
 * Icon urls are attacker-adjacent data, so nothing from them reaches the file
 * system except an extension drawn from a fixed image allowlist. File names come
 * from the achievement index instead.
 */
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

  // The catalogue returns a bare directory url when a game has no gray icon
  const icongray = achievement.icongray?.endsWith("/")
    ? icon
    : achievement.icongray;

  return { icon, icongray: icongray || icon };
};

/**
 * Converts catalogue achievements into the `steam_settings/achievements.json`
 * metadata format the Steam emulators read, alongside the icon downloads it
 * references. Icons are numbered by achievement position, which is what keeps
 * the file names stable and free of anything derived from a remote url.
 */
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
