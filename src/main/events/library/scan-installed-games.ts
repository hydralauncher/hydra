import path from "node:path";
import fs from "node:fs";
import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { GameExecutables, logger, WindowManager } from "@main/services";

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

const scanInstalledGames = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<ScanResult> => {
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

  for (const { key, game } of games) {
    if (game.executablePath) {
      continue;
    }

    const executableNames = GameExecutables.getExecutablesForGame(
      game.objectId
    );

    if (!executableNames || executableNames.length === 0) {
      continue;
    }

    const normalizedNames = new Set(
      executableNames.map((name) => name.toLowerCase())
    );

    let foundPath: string | null = null;

    for (const scanDir of SCAN_DIRECTORIES) {
      if (!fs.existsSync(scanDir)) {
        continue;
      }

      foundPath = await findExecutableInFolder(scanDir, normalizedNames);

      if (foundPath) {
        break;
      }
    }

    if (foundPath) {
      await gamesSublevel.put(key, {
        ...game,
        executablePath: foundPath,
      });

      logger.info(
        `[ScanInstalledGames] Found executable for ${game.objectId}: ${foundPath}`
      );

      foundGames.push({
        title: game.title,
        executablePath: foundPath,
      });
    }
  }

  WindowManager.mainWindow?.webContents.send("on-library-batch-complete");

  return {
    foundGames,
    total: games.filter((g) => !g.game.executablePath).length,
  };
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
