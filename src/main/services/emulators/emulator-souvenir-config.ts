import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { db, levelKeys } from "@main/level";
import { logger } from "../logger";
import {
  duckstationConfigCandidates,
  findExistingConfig,
} from "./emulator-config";
import {
  getCfgLine,
  getCfgValue,
  restoreRetroArchSouvenirConfigValues,
  setRetroArchSouvenirConfigValues,
  usesRetroArchContentScreenshotDirectory,
} from "./retroarch-souvenir-config-value";

const setIniValue = (
  content: string,
  section: string,
  key: string,
  value: string
) => {
  const lines = content.split(/\r?\n/);
  const sectionIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === `[${section.toLowerCase()}]`
  );

  if (sectionIndex === -1) {
    return `${content.trimEnd()}\n\n[${section}]\n${key} = ${value}\n`;
  }

  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("[")) {
      lines.splice(index, 0, `${key} = ${value}`);
      return lines.join("\n");
    }

    const separator = lines[index].indexOf("=");
    if (separator === -1) continue;

    if (lines[index].slice(0, separator).trim() === key) {
      lines[index] = `${key} = ${value}`;
      return lines.join("\n");
    }
  }

  lines.push(`${key} = ${value}`);
  return lines.join("\n");
};

interface RetroArchSouvenirConfigBackup {
  configPath: string;
  originalLine: string | null;
  originalScreenshotDirectoryLine?: string | null;
}

const getRetroArchSouvenirConfigBackups = async () =>
  (await db.get<string, RetroArchSouvenirConfigBackup[]>(
    levelKeys.retroArchSouvenirConfigBackups,
    { valueEncoding: "json" }
  )) ?? [];

export const retroArchConfigRoots = (executablePath: string): string[] => {
  const home = os.homedir();

  if (executablePath.includes("org.libretro.RetroArch")) {
    return [
      path.join(
        home,
        ".var",
        "app",
        "org.libretro.RetroArch",
        "config",
        "retroarch"
      ),
    ];
  }

  const roots = [path.dirname(executablePath)];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) roots.push(path.join(appData, "RetroArch"));
  } else {
    roots.push(path.join(home, ".config", "retroarch"));
  }

  return roots;
};

export const findRetroArchConfig = (executablePath: string) =>
  findExistingConfig(
    retroArchConfigRoots(executablePath).map((root) =>
      path.join(root, "retroarch.cfg")
    )
  );

const uniqueDirectories = (directories: Array<string | null>) =>
  Array.from(new Set(directories.filter((value): value is string => !!value)));

export const getRetroArchAchievementScreenshotDirectory = (
  configPath: string
) => path.join(path.dirname(configPath), "hydra-souvenirs");

export const readRetroArchScreenshotDirectories = (
  configPath: string,
  contentPath: string | null
) => {
  let configuredDirectory: string | null = null;
  let useContentDirectoryFallback = true;

  try {
    const content = fs.readFileSync(configPath, "utf8");
    const raw = getCfgValue(content, "screenshot_directory");

    if (raw && !usesRetroArchContentScreenshotDirectory(raw)) {
      configuredDirectory = raw.startsWith("~")
        ? path.join(os.homedir(), raw.slice(1))
        : path.isAbsolute(raw)
          ? raw
          : path.join(path.dirname(configPath), raw);

      if (!fs.existsSync(configuredDirectory)) {
        logger.warn(
          "Configured RetroArch screenshot directory does not exist",
          {
            configPath,
            screenshotDirectory: configuredDirectory,
          }
        );
        configuredDirectory = null;
        useContentDirectoryFallback = true;
      } else {
        useContentDirectoryFallback = false;
      }
    }
  } catch (error) {
    logger.error("Failed to read RetroArch screenshot directory", error);
    useContentDirectoryFallback = true;
  }

  const contentDirectory =
    useContentDirectoryFallback && contentPath
      ? path.dirname(contentPath)
      : null;
  const defaultScreenshotDirectoryCandidate = path.join(
    path.dirname(configPath),
    "screenshots"
  );
  const defaultScreenshotDirectory =
    useContentDirectoryFallback &&
    fs.existsSync(defaultScreenshotDirectoryCandidate)
      ? defaultScreenshotDirectoryCandidate
      : null;

  return uniqueDirectories([
    configuredDirectory,
    contentDirectory,
    defaultScreenshotDirectory,
    getRetroArchAchievementScreenshotDirectory(configPath),
  ]);
};

export const enableRetroArchAchievementScreenshots = async (
  executablePath: string
) => {
  const configPath = findRetroArchConfig(executablePath);

  if (!configPath) {
    logger.warn("Could not find RetroArch config for achievement screenshots", {
      executablePath,
    });
    return;
  }

  try {
    const screenshotDirectory =
      getRetroArchAchievementScreenshotDirectory(configPath);

    await fs.promises.mkdir(screenshotDirectory, {
      recursive: true,
    });

    const content = fs.readFileSync(configPath, "utf8");
    const backups = await getRetroArchSouvenirConfigBackups();
    const existingBackupIndex = backups.findIndex(
      (backup) => backup.configPath === configPath
    );
    const updatedBackups = [...backups];

    if (existingBackupIndex === -1) {
      updatedBackups.push({
        configPath,
        originalLine: getCfgLine(content, "cheevos_auto_screenshot"),
        originalScreenshotDirectoryLine: getCfgLine(
          content,
          "screenshot_directory"
        ),
      });
    } else if (
      updatedBackups[existingBackupIndex].originalScreenshotDirectoryLine ===
      undefined
    ) {
      updatedBackups[existingBackupIndex] = {
        ...updatedBackups[existingBackupIndex],
        originalScreenshotDirectoryLine: getCfgLine(
          content,
          "screenshot_directory"
        ),
      };
    }

    await db.put<string, RetroArchSouvenirConfigBackup[]>(
      levelKeys.retroArchSouvenirConfigBackups,
      updatedBackups,
      { valueEncoding: "json" }
    );

    const updated = setRetroArchSouvenirConfigValues(
      content,
      screenshotDirectory
    );

    if (updated !== content) fs.writeFileSync(configPath, updated, "utf8");

    logger.info("Enabled RetroArch achievement screenshots", {
      configPath,
      screenshotDirectory,
    });
  } catch (error) {
    logger.error("Failed to enable RetroArch achievement screenshots", error);
  }
};

export const restoreRetroArchAchievementScreenshots = async () => {
  let backups: RetroArchSouvenirConfigBackup[];

  try {
    backups = await getRetroArchSouvenirConfigBackups();
  } catch (error) {
    logger.error("Failed to read RetroArch souvenir config backups", error);
    return;
  }

  const retainedBackups: RetroArchSouvenirConfigBackup[] = [];

  for (const backup of backups) {
    if (!fs.existsSync(backup.configPath)) continue;

    try {
      const content = fs.readFileSync(backup.configPath, "utf8");
      const restored = restoreRetroArchSouvenirConfigValues(
        content,
        backup.originalLine,
        backup.originalScreenshotDirectoryLine
      );

      if (restored !== content) {
        fs.writeFileSync(backup.configPath, restored, "utf8");
      }

      logger.info("Restored RetroArch achievement screenshot configuration", {
        configPath: backup.configPath,
      });
    } catch (error) {
      retainedBackups.push(backup);
      logger.error(
        "Failed to restore RetroArch achievement screenshots",
        error
      );
    }
  }

  if (retainedBackups.length) {
    await db.put<string, RetroArchSouvenirConfigBackup[]>(
      levelKeys.retroArchSouvenirConfigBackups,
      retainedBackups,
      { valueEncoding: "json" }
    );
  } else {
    await db.del(levelKeys.retroArchSouvenirConfigBackups);
  }
};

export const enableDuckStationFileLogging = () => {
  const configPath = findExistingConfig(duckstationConfigCandidates());

  if (!configPath) return;

  try {
    const content = fs.readFileSync(configPath, "utf8");
    const updated = setIniValue(content, "Logging", "LogToFile", "true");

    if (updated !== content) fs.writeFileSync(configPath, updated, "utf8");
  } catch (error) {
    logger.error("Failed to enable DuckStation file logging", error);
  }
};
