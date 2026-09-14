import path from "node:path";

import type { AchievementMetadataEntry, SteamAchievement } from "@types";

export const ACHIEVEMENT_IMAGES_DIR_NAME = "images";

const ALTERNATE_ICON_GRAY_KEY = "icon_gray";

const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:/;

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
  relativePath: string;
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

const getAchievementIconUrls = (achievement: SteamAchievement) => {
  const icon = achievement.icon;

  const icongray = achievement.icongray?.endsWith("/")
    ? icon
    : achievement.icongray;

  return { icon, icongray: icongray || icon };
};

export const buildAchievementMetadata = (
  achievements: SteamAchievement[],
  imagesDirName: string = ACHIEVEMENT_IMAGES_DIR_NAME
): AchievementMetadata => {
  const entries: AchievementMetadataEntry[] = [];
  const icons: AchievementIcon[] = [];

  for (const achievement of achievements.filter(({ name }) => Boolean(name))) {
    const { icon, icongray } = getAchievementIconUrls(achievement);

    const position = entries.length + 1;

    const iconPath = `${imagesDirName}/${position}${getIconExtension(icon)}`;
    const icongrayPath = `${imagesDirName}/${position}_gray${getIconExtension(
      icongray
    )}`;

    entries.push({
      description: achievement.description ?? "",
      displayName: achievement.displayName ?? achievement.name,
      hidden: achievement.hidden ? 1 : 0,
      icon: iconPath,
      icongray: icongrayPath,
      name: achievement.name,
    });

    icons.push(
      { relativePath: iconPath, url: icon },
      { relativePath: icongrayPath, url: icongray }
    );
  }

  return { entries, icons };
};

export const sanitizeRelativeIconPath = (iconPath: unknown) => {
  if (typeof iconPath !== "string") return null;

  const normalized = iconPath.trim().replaceAll("\\", "/");

  if (!normalized || normalized.startsWith("/")) return null;
  if (WINDOWS_DRIVE_PREFIX.test(normalized)) return null;

  const segments = normalized
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");

  if (!segments.length || segments.includes("..")) return null;

  return segments.join("/");
};

export const getExistingEntryIconPaths = (entry: AchievementMetadataEntry) => {
  const icongray =
    entry.icongray ??
    (entry as unknown as Record<string, unknown>)[ALTERNATE_ICON_GRAY_KEY];

  return {
    icon: sanitizeRelativeIconPath(entry.icon),
    icongray: sanitizeRelativeIconPath(icongray),
  };
};

export const buildIconsForExistingMetadata = (
  achievements: SteamAchievement[],
  existingEntries: AchievementMetadataEntry[]
): AchievementIcon[] => {
  const urlsByName = new Map(
    achievements
      .filter(({ name }) => Boolean(name))
      .map((achievement) => [
        achievement.name.toUpperCase(),
        getAchievementIconUrls(achievement),
      ])
  );

  const icons: AchievementIcon[] = [];

  for (const entry of existingEntries) {
    if (typeof entry?.name !== "string") continue;

    const urls = urlsByName.get(entry.name.toUpperCase());

    if (!urls) continue;

    const { icon: iconPath, icongray: icongrayPath } =
      getExistingEntryIconPaths(entry);

    for (const [relativePath, url] of [
      [iconPath, urls.icon],
      [icongrayPath, urls.icongray],
    ] as const) {
      if (!relativePath || !url) continue;

      icons.push({ relativePath, url });
    }
  }

  return icons;
};
