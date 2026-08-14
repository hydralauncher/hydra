import path from "node:path";
import fs from "node:fs";

import axios from "axios";

import { achievementsLogger } from "../../logger";
import { resolveContainedDirectory } from "../game-directory.js";
import type { AchievementIcon } from "./build-achievement-metadata";
import type { AchievementMetadataExportTarget } from "./generate-achievement-metadata";

const CONCURRENCY = 8;
const REQUEST_TIMEOUT_IN_MS = 15_000;
const PROGRESS_REPORT_INTERVAL = 10;

interface DownloadAchievementIconsOptions {
  containmentRoot: string;
  targets: AchievementMetadataExportTarget[];
  signal?: AbortSignal;
  onProgress?: (downloaded: number, total: number) => void;
}

interface ResolvedIcon {
  filePath: string;
  url: string;
}

const resolveIconDirectories = async (
  containmentRoot: string,
  steamSettingsDirectory: string,
  icons: AchievementIcon[]
) => {
  const resolvedParent = await resolveContainedDirectory(
    containmentRoot,
    steamSettingsDirectory
  );

  if (!resolvedParent) {
    achievementsLogger.error(
      `Refusing to write achievement icons: ${steamSettingsDirectory} is outside ${containmentRoot}`
    );

    return [];
  }

  const iconsByDirectory = new Map<string, AchievementIcon[]>();

  for (const icon of icons) {
    const directory = path.posix.dirname(icon.relativePath);
    const directoryIcons = iconsByDirectory.get(directory) ?? [];

    directoryIcons.push(icon);
    iconsByDirectory.set(directory, directoryIcons);
  }

  const resolvedIcons: ResolvedIcon[] = [];

  for (const [directory, directoryIcons] of iconsByDirectory) {
    const iconsDirectory = path.join(resolvedParent, directory);

    await fs.promises.mkdir(iconsDirectory, { recursive: true });

    const resolvedIconsDirectory = await resolveContainedDirectory(
      containmentRoot,
      iconsDirectory
    );

    if (!resolvedIconsDirectory) {
      achievementsLogger.error(
        `Refusing to write achievement icons: ${iconsDirectory} is outside ${containmentRoot}`
      );
      continue;
    }

    const entries = await fs.promises
      .readdir(resolvedIconsDirectory)
      .catch(() => []);

    const presentFileNames = new Set(entries);

    for (const icon of directoryIcons) {
      const fileName = path.posix.basename(icon.relativePath);

      if (presentFileNames.has(fileName)) continue;

      presentFileNames.add(fileName);

      resolvedIcons.push({
        filePath: path.join(resolvedIconsDirectory, fileName),
        url: icon.url,
      });
    }
  }

  return resolvedIcons;
};

const downloadIcon = async (icon: ResolvedIcon, signal?: AbortSignal) => {
  const response = await axios.get<ArrayBuffer>(icon.url, {
    responseType: "arraybuffer",
    timeout: REQUEST_TIMEOUT_IN_MS,
    signal,
  });

  await fs.promises.writeFile(icon.filePath, Buffer.from(response.data));
};

export const downloadAchievementIcons = async ({
  containmentRoot,
  targets,
  signal,
  onProgress,
}: DownloadAchievementIconsOptions) => {
  const pendingIcons: ResolvedIcon[] = [];

  for (const { steamSettingsDirectory, icons } of targets) {
    if (signal?.aborted) return;

    pendingIcons.push(
      ...(await resolveIconDirectories(
        containmentRoot,
        steamSettingsDirectory,
        icons
      ))
    );
  }

  if (!pendingIcons.length) return;

  let downloaded = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < pendingIcons.length) {
      if (signal?.aborted) return;

      const icon = pendingIcons[cursor++];

      try {
        await downloadIcon(icon, signal);
      } catch (error) {
        if (signal?.aborted) return;

        achievementsLogger.error(
          `Failed to download achievement icon ${icon.url}`,
          error
        );
      }

      downloaded++;

      if (
        downloaded % PROGRESS_REPORT_INTERVAL === 0 ||
        downloaded === pendingIcons.length
      ) {
        onProgress?.(downloaded, pendingIcons.length);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pendingIcons.length) }, worker)
  );
};
