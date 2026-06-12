import path from "node:path";
import fs from "node:fs";
import { t } from "i18next";
import { registerEvent } from "../register-event";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { gamesSublevel } from "@main/level";
import {
  GameExecutables,
  LocalNotificationManager,
  logger,
  WindowManager,
} from "@main/services";

const SCAN_DIRECTORIES = [
  String.raw`C:\Games`,
  String.raw`D:\Games`,
  String.raw`C:\Program Files (x86)\Steam\steamapps\common`,
  String.raw`C:\Program Files\Steam\steamapps\common`,
  String.raw`C:\Program Files (x86)\DODI-Repacks`,
];

interface FoundGame {
  title: string;
  executablePath: string;
}

interface ScanResult {
  foundGames: FoundGame[];
  total: number;
}

async function searchInDirectories(
  executableNames: Set<string>,
  directories: string[]
): Promise<string | null> {
  for (const scanDir of directories) {
    if (!fs.existsSync(scanDir)) continue;

    const foundPath = await findExecutableInFolder(scanDir, executableNames);
    if (foundPath) return foundPath;
  }
  return null;
}

async function publishScanNotification(foundCount: number): Promise<void> {
  const hasFoundGames = foundCount > 0;

  await LocalNotificationManager.createNotification(
    "SCAN_GAMES_COMPLETE",
    t(
      hasFoundGames
        ? "scan_games_complete_title"
        : "scan_games_no_results_title",
      { ns: "notifications" }
    ),
    t(
      hasFoundGames
        ? "scan_games_complete_description"
        : "scan_games_no_results_description",
      { ns: "notifications", count: foundCount }
    ),
    { url: "/library?openScanModal=true" }
  );
}

const scanInstalledGames = async (
  _event: Electron.IpcMainInvokeEvent,
  additionalDirectories: string[] = [],
  includeDefaultDirectories = true
): Promise<ScanResult> => {
  const baseDirectories = includeDefaultDirectories ? SCAN_DIRECTORIES : [];
  const scanDirectories = [
    ...new Set([...baseDirectories, ...additionalDirectories]),
  ];

  const games = await gamesSublevel
    .iterator()
    .all()
    .then((results) =>
      results
        .filter(
          ([_key, game]) => game.isDeleted === false && game.shop !== "custom"
        )
        .map(([key, game]) => ({ key, game }))
    );

  const foundGames: FoundGame[] = [];
  const gamesToScan = games.filter((g) => !g.game.executablePath);

  for (const { key, game } of gamesToScan) {
    const executableNames = GameExecutables.getExecutablesForGame(
      game.objectId
    );

    if (!executableNames || executableNames.length === 0) continue;

    const normalizedNames = new Set(
      executableNames.map((name) => name.toLowerCase())
    );

    const foundPath = await searchInDirectories(
      normalizedNames,
      scanDirectories
    );

    if (foundPath) {
      await gamesSublevel.put(key, updateGameExecutablePath(game, foundPath));

      logger.info(
        `[ScanInstalledGames] Found executable for ${game.objectId}: ${foundPath}`
      );

      foundGames.push({ title: game.title, executablePath: foundPath });
    }
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");
  await publishScanNotification(foundGames.length);

  return { foundGames, total: gamesToScan.length };
};

async function findExecutableInFolder(
  folderPath: string,
  executableNames: Set<string>
): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(folderPath, {
      withFileTypes: true,
      recursive: true,
    });

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const fileName = entry.name.toLowerCase();

      if (executableNames.has(fileName)) {
        const parentPath =
          "parentPath" in entry ? entry.parentPath : folderPath;

        return path.join(parentPath, entry.name);
      }
    }
  } catch (err) {
    logger.error(
      `[ScanInstalledGames] Error reading folder ${folderPath}:`,
      err
    );
  }

  return null;
}

registerEvent("scanInstalledGames", scanInstalledGames);
