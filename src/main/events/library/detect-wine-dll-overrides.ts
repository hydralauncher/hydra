import path from "node:path";
import fs from "node:fs";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { detectExecutableArchitecture } from "@main/helpers/executable-architecture";
import { getSteamLocation, Wine } from "@main/services";
import {
  GameShop,
  type Game,
  type WineDllOverridesDetectionResult,
} from "@types";

const ONLINEFIX_DLL_PREFIX = "onlinefix";
const STEAM_OVERLAY_GAME_ID = "480";

// Matches the DLL-proxying/compatibility file names crack loaders actually
// use (winmm, onlinefix64, steam_api64, eossdk-*, etc.)
const RELEVANT_DLL_NAME_PATTERN =
  /^(?:(?:emp|custom)\.dll|win.*\.dll|(?:online|steam).*\.dll|eos.*\.dll|epicfix.*\.dll)$/i;
const DLL_LIST_FILE_PATTERN = /^(?:winmm|dlllist)\.txt$/i;

const detectSteamOverlayEnv = async (
  game: Game,
  executablePath: string
): Promise<Record<string, string> | null> => {
  const winePrefixPath = await Wine.resolvePrefixPath(
    Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId)
  );
  if (!winePrefixPath) return null;

  const steamLocation = await getSteamLocation().catch(() => null);
  if (!steamLocation) return null;

  const architecture = await detectExecutableArchitecture(executablePath);
  const overlayArchDir = architecture === "32" ? "ubuntu12_32" : "ubuntu12_64";
  const gameOverlayRendererPath = path.join(
    steamLocation,
    overlayArchDir,
    "gameoverlayrenderer.so"
  );

  if (!fs.existsSync(gameOverlayRendererPath)) return null;

  return {
    STEAM_COMPAT_DATA_PATH: winePrefixPath,
    STEAM_COMPAT_CLIENT_INSTALL_PATH: steamLocation,
    LD_PRELOAD: gameOverlayRendererPath,
    ENABLE_VK_LAYER_VALVE_steam_overlay_1: "1",
    SteamOverlayGameId: STEAM_OVERLAY_GAME_ID,
  };
};

export const detectWineDllOverridesForGame = async (
  game: Game
): Promise<WineDllOverridesDetectionResult> => {
  if (!game.executablePath) return { dllNames: [], steamOverlayEnv: null };

  const gameFolder = path.dirname(game.executablePath);
  const entries = await fs.promises
    .readdir(gameFolder, { withFileTypes: true })
    .catch(() => []);

  const namesFromDlls = entries
    .filter(
      (entry) => entry.isFile() && RELEVANT_DLL_NAME_PATTERN.test(entry.name)
    )
    .map((entry) => entry.name.slice(0, -4).toLowerCase());

  const listFiles = entries.filter(
    (entry) => entry.isFile() && DLL_LIST_FILE_PATTERN.test(entry.name)
  );

  const namesFromListFiles: string[] = [];
  for (const listFile of listFiles) {
    const content = await fs.promises
      .readFile(path.join(gameFolder, listFile.name), "utf8")
      .catch(() => "");

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.toLowerCase().endsWith(".dll")) continue;

      namesFromListFiles.push(
        path.basename(trimmed.replaceAll("\\", "/"), ".dll").toLowerCase()
      );
    }
  }

  const dllNames = [...new Set([...namesFromDlls, ...namesFromListFiles])].sort(
    (a, b) => a.localeCompare(b)
  );

  const hasOnlineFix = dllNames.some((name) =>
    name.startsWith(ONLINEFIX_DLL_PREFIX)
  );

  const steamOverlayEnv = hasOnlineFix
    ? await detectSteamOverlayEnv(game, game.executablePath)
    : null;

  return { dllNames, steamOverlayEnv };
};

const detectWineDllOverrides = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<WineDllOverridesDetectionResult> => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  if (!game) return { dllNames: [], steamOverlayEnv: null };

  return detectWineDllOverridesForGame(game);
};

registerEvent("detectWineDllOverrides", detectWineDllOverrides);
