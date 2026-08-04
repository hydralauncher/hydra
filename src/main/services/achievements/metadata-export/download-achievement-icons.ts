import path from "node:path";
import fs from "node:fs";

import axios from "axios";

import { achievementsLogger } from "../../logger";
import {
  ACHIEVEMENT_IMAGES_DIR_NAME,
  type AchievementIcon,
} from "./build-achievement-metadata";

const CONCURRENCY = 8;
const REQUEST_TIMEOUT_IN_MS = 15_000;

interface DownloadAchievementIconsOptions {
  steamSettingsDirectories: string[];
  icons: AchievementIcon[];
  signal?: AbortSignal;
  onProgress?: (downloaded: number, total: number) => void;
}

const downloadIcon = async (
  icon: AchievementIcon,
  imagesDirectories: string[],
  signal?: AbortSignal
) => {
  const missingDirectories = imagesDirectories.filter(
    (imagesDirectory) =>
      !fs.existsSync(path.join(imagesDirectory, icon.fileName))
  );

  if (!missingDirectories.length) return;

  const response = await axios.get<ArrayBuffer>(icon.url, {
    responseType: "arraybuffer",
    timeout: REQUEST_TIMEOUT_IN_MS,
    signal,
  });

  await Promise.all(
    missingDirectories.map((imagesDirectory) =>
      fs.promises.writeFile(
        path.join(imagesDirectory, icon.fileName),
        Buffer.from(response.data)
      )
    )
  );
};

/**
 * Downloads the colored and gray icons referenced by generated achievement
 * metadata. Only the emulator's own in-game overlay consumes them, so this runs
 * detached from the launch flow and never reports failures as fatal.
 */
export const downloadAchievementIcons = async ({
  steamSettingsDirectories,
  icons,
  signal,
  onProgress,
}: DownloadAchievementIconsOptions) => {
  const imagesDirectories = steamSettingsDirectories.map((directory) =>
    path.join(directory, ACHIEVEMENT_IMAGES_DIR_NAME)
  );

  for (const imagesDirectory of imagesDirectories) {
    await fs.promises.mkdir(imagesDirectory, { recursive: true });
  }

  let downloaded = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < icons.length) {
      if (signal?.aborted) return;

      const icon = icons[cursor++];

      try {
        await downloadIcon(icon, imagesDirectories, signal);
      } catch (error) {
        achievementsLogger.error(
          `Failed to download achievement icon ${icon.url}`,
          error
        );
      }

      downloaded++;
      onProgress?.(downloaded, icons.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, icons.length) }, worker)
  );
};
