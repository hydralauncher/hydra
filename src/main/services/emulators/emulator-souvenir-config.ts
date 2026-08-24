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
  getCfgValue,
  buildRetroArchSouvenirAppendConfig,
  restoreRetroArchSouvenirConfigValues,
  usesRetroArchContentScreenshotDirectory,
} from "./retroarch-souvenir-config-value";
import {
  getIniLine,
  restoreIniValue,
  setIniValue,
} from "./duckstation-souvenir-config-value";

interface RetroArchSouvenirConfigBackup {
  configPath: string;
  originalLine: string | null;
  originalScreenshotDirectoryLine?: string | null;
}

interface DuckStationSouvenirConfigBackup {
  configPath: string;
  originalLine: string | null;
}

export interface RetroArchSouvenirSession {
  appendConfigPath: string;
  screenshotDirectory: string;
  sessionDirectory: string;
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

const resolveRetroArchScreenshotDirectory = (
  configPath: string,
  configuredPath: string
) => {
  if (configuredPath.startsWith("~")) {
    return path.join(os.homedir(), configuredPath.slice(1));
  }

  if (path.isAbsolute(configuredPath)) return configuredPath;

  return path.join(path.dirname(configPath), configuredPath);
};

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
      configuredDirectory = resolveRetroArchScreenshotDirectory(
        configPath,
        raw
      );

      if (!fs.existsSync(configuredDirectory)) {
        logger.warn(
          "Configured RetroArch screenshot directory does not exist",
          {
            configPath,
            screenshotDirectory: configuredDirectory,
          }
        );
        configuredDirectory = null;
      } else {
        useContentDirectoryFallback = false;
      }
    }
  } catch (error) {
    logger.error("Failed to read RetroArch screenshot directory", error);
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

export const createRetroArchSouvenirSession = async () => {
  await restoreRetroArchAchievementScreenshots();

  let sessionDirectory: string | null = null;

  try {
    sessionDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-retroarch-souvenirs-")
    );
    const screenshotDirectory = path.join(sessionDirectory, "screenshots");
    const appendConfigPath = path.join(sessionDirectory, "souvenirs.cfg");

    await fs.promises.mkdir(screenshotDirectory);
    await fs.promises.writeFile(
      appendConfigPath,
      buildRetroArchSouvenirAppendConfig(screenshotDirectory),
      "utf8"
    );

    logger.info("Prepared RetroArch souvenir session", {
      appendConfigPath,
      screenshotDirectory,
    });

    return {
      appendConfigPath,
      screenshotDirectory,
      sessionDirectory,
    } satisfies RetroArchSouvenirSession;
  } catch (error) {
    if (sessionDirectory) {
      await fs.promises
        .rm(sessionDirectory, { recursive: true, force: true })
        .catch(() => {});
    }
    logger.error("Failed to prepare RetroArch souvenir session", error);
    return null;
  }
};

export const cleanupRetroArchSouvenirSession = async (
  session: RetroArchSouvenirSession | null | undefined
) => {
  if (!session) return;

  try {
    await fs.promises.rm(session.sessionDirectory, {
      recursive: true,
      force: true,
    });
    logger.info("Cleaned up RetroArch souvenir session", {
      sessionDirectory: session.sessionDirectory,
    });
  } catch (error) {
    logger.error("Failed to clean up RetroArch souvenir session", error);
  }
};

const getDuckStationSouvenirConfigBackups = async () =>
  (await db.get<string, DuckStationSouvenirConfigBackup[]>(
    levelKeys.duckStationSouvenirConfigBackups,
    { valueEncoding: "json" }
  )) ?? [];

export const enableDuckStationFileLogging = async () => {
  const configPath = findExistingConfig(duckstationConfigCandidates());

  if (!configPath) return;

  try {
    const content = fs.readFileSync(configPath, "utf8");
    const backups = await getDuckStationSouvenirConfigBackups();
    if (!backups.some((backup) => backup.configPath === configPath)) {
      await db.put<string, DuckStationSouvenirConfigBackup[]>(
        levelKeys.duckStationSouvenirConfigBackups,
        [
          ...backups,
          {
            configPath,
            originalLine: getIniLine(content, "Logging", "LogToFile"),
          },
        ],
        { valueEncoding: "json" }
      );
    }
    const updated = setIniValue(content, "Logging", "LogToFile", "true");

    if (updated !== content) fs.writeFileSync(configPath, updated, "utf8");
  } catch (error) {
    logger.error("Failed to enable DuckStation file logging", error);
  }
};

export const restoreDuckStationFileLogging = async () => {
  let backups: DuckStationSouvenirConfigBackup[];

  try {
    backups = await getDuckStationSouvenirConfigBackups();
  } catch (error) {
    logger.error("Failed to read DuckStation souvenir config backups", error);
    return;
  }

  const retainedBackups: DuckStationSouvenirConfigBackup[] = [];

  for (const backup of backups) {
    if (!fs.existsSync(backup.configPath)) continue;

    try {
      const content = fs.readFileSync(backup.configPath, "utf8");
      const restored = restoreIniValue(
        content,
        "Logging",
        "LogToFile",
        backup.originalLine
      );
      if (restored !== content) {
        fs.writeFileSync(backup.configPath, restored, "utf8");
      }
    } catch (error) {
      retainedBackups.push(backup);
      logger.error("Failed to restore DuckStation file logging", error);
    }
  }

  if (retainedBackups.length) {
    await db.put<string, DuckStationSouvenirConfigBackup[]>(
      levelKeys.duckStationSouvenirConfigBackups,
      retainedBackups,
      { valueEncoding: "json" }
    );
  } else {
    await db.del(levelKeys.duckStationSouvenirConfigBackups);
  }
};
