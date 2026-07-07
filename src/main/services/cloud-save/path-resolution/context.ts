import type { GameShop } from "@types";

import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamLocation, getSteamUsersIds } from "@main/services/steam";
import { SystemPath } from "@main/services/system-path";
import { Wine } from "@main/services/wine";
import path from "node:path";

import type {
  CloudSavePathResolutionContext,
  WindowsLikePathKind,
} from "./types";

const getCloudSavePathPlatform =
  (): CloudSavePathResolutionContext["platform"] =>
    process.platform === "win32" ? "windows" : "linux";

const getWindowsLikeUsername = (homeDir: string): string | null => {
  const username = homeDir.split("/").pop();
  return username || null;
};

const getWindowsLikePath = (
  kind: WindowsLikePathKind,
  platform: CloudSavePathResolutionContext["platform"],
  homeDir: string,
  winePrefixPath: string | null
): string | null => {
  if (platform === "windows") {
    const windowsPaths: Record<WindowsLikePathKind, string> = {
      documents: SystemPath.getPath("documents"),
      appData: SystemPath.getPath("appData"),
      localAppData: path.join(SystemPath.getPath("appData"), "..", "Local"),
      public: path.join("C:", "Users", "Public"),
      programData: path.join("C:", "ProgramData"),
    };

    return windowsPaths[kind];
  }

  if (!winePrefixPath) return null;

  const username = getWindowsLikeUsername(homeDir);
  const linuxPaths: Record<WindowsLikePathKind, string | null> = {
    documents: username
      ? path.join("drive_c", "users", username, "Documents")
      : null,
    appData: username
      ? path.join("drive_c", "users", username, "AppData", "Roaming")
      : null,
    localAppData: username
      ? path.join("drive_c", "users", username, "AppData", "Local")
      : null,
    public: path.join("drive_c", "users", "Public"),
    programData: path.join("drive_c", "ProgramData"),
  };

  return linuxPaths[kind];
};

const getInstallDir = (executablePath: string | null): string | null => {
  return executablePath ? path.dirname(executablePath) : null;
};

const getCloudSavePathResolutionGame = async (
  shop: GameShop,
  objectId: string
) => {
  try {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

    if (!game || game.isDeleted) return null;

    return game;
  } catch {
    return null;
  }
};

export const buildCloudSavePathResolutionContext = async (
  shop: GameShop,
  objectId: string
): Promise<CloudSavePathResolutionContext> => {
  const game = await getCloudSavePathResolutionGame(shop, objectId);

  if (!game) {
    throw new Error(
      `Game not found for cloud save path resolution: ${shop}:${objectId}`
    );
  }

  const platform = getCloudSavePathPlatform();
  const homeDir = SystemPath.getPath("home");
  const executablePath = game.executablePath ?? null;
  const protonPath = game.protonPath ?? null;
  const winePrefixPath = Wine.getEffectivePrefixPath(
    game.winePrefixPath,
    objectId
  );

  const steamPath =
    shop === "steam" ? await getSteamLocation().catch(() => null) : null;

  const steamUserIds =
    shop === "steam" ? await getSteamUsersIds().catch(() => []) : [];

  return {
    shop,
    objectId,
    platform,
    homeDir,
    documentsDir: getWindowsLikePath(
      "documents",
      platform,
      homeDir,
      winePrefixPath
    ),
    appDataDir: getWindowsLikePath(
      "appData",
      platform,
      homeDir,
      winePrefixPath
    ),
    localAppDataDir: getWindowsLikePath(
      "localAppData",
      platform,
      homeDir,
      winePrefixPath
    ),
    publicDir: getWindowsLikePath("public", platform, homeDir, winePrefixPath),
    programDataDir: getWindowsLikePath(
      "programData",
      platform,
      homeDir,
      winePrefixPath
    ),
    installDir: getInstallDir(executablePath),
    executablePath,
    winePrefixPath,
    protonPath,
    steamPath,
    steamUserIds: steamUserIds.map(String),
  };
};
