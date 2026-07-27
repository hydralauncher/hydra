import { registerEvent } from "./register-event";
import type { GameShop } from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import { YandexDiskBackup } from "@main/services/yandex-disk-backup";
import { logger } from "@main/services";

const getYandexDiskSettings = async (_event: Electron.IpcMainInvokeEvent) => {
  try {
    const prefs = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );
    return {
      token: prefs?.yandexDiskToken ?? null,
      backupEnabled: prefs?.yandexDiskBackupEnabled ?? false,
      restoreOnStartup: prefs?.yandexDiskRestoreOnStartup ?? false,
      maxBackups: prefs?.yandexDiskMaxBackups ?? 5,
    };
  } catch {
    return {
      token: null,
      backupEnabled: false,
      restoreOnStartup: false,
      maxBackups: 5,
    };
  }
};

const updateYandexDiskSettings = async (
  _event: Electron.IpcMainInvokeEvent,
  settings: {
    token?: string | null;
    backupEnabled?: boolean;
    restoreOnStartup?: boolean;
    maxBackups?: number;
  }
) => {
  let prefs: UserPreferences | null = null;
  try {
    prefs = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      {
        valueEncoding: "json",
      }
    );
  } catch {
    prefs = null;
  }

  const updated: UserPreferences = {
    ...(prefs ?? {}),
  };

  if (settings.token !== undefined) updated.yandexDiskToken = settings.token;
  if (settings.backupEnabled !== undefined)
    updated.yandexDiskBackupEnabled = settings.backupEnabled;
  if (settings.restoreOnStartup !== undefined)
    updated.yandexDiskRestoreOnStartup = settings.restoreOnStartup;
  if (settings.maxBackups !== undefined)
    updated.yandexDiskMaxBackups = settings.maxBackups;

  await db.put(levelKeys.userPreferences, updated, { valueEncoding: "json" });
  return true;
};

const getYandexDiskAccountInfo = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  return YandexDiskBackup.getAccountInfo();
};

const validateYandexDiskToken = async (
  _event: Electron.IpcMainInvokeEvent,
  token: string
) => {
  return YandexDiskBackup.validateToken(token);
};

const listYandexDiskBackups = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  return YandexDiskBackup.listBackups({ objectId, shop });
};

const restoreYandexDiskBackup = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  remotePath: string
) => {
  try {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey);
    if (!game) throw new Error("Game not found");

    await YandexDiskBackup.downloadAndRestoreBackup(game, remotePath);
    return { success: true };
  } catch (err) {
    logger.error("[YandexDisk] restoreYandexDiskBackup error", err);
    throw err;
  }
};

const backupNowYandexDisk = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  try {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey);
    if (!game) throw new Error("Game not found");

    await YandexDiskBackup.backupOnGameExit(game);
    return { success: true };
  } catch (err) {
    logger.error("[YandexDisk] backupNowYandexDisk error", err);
    throw err;
  }
};

registerEvent("getYandexDiskSettings", getYandexDiskSettings);
registerEvent("getYandexDiskAccountInfo", getYandexDiskAccountInfo);
registerEvent("updateYandexDiskSettings", updateYandexDiskSettings);
registerEvent("validateYandexDiskToken", validateYandexDiskToken);
registerEvent("listYandexDiskBackups", listYandexDiskBackups);
registerEvent("restoreYandexDiskBackup", restoreYandexDiskBackup);
registerEvent("backupNowYandexDisk", backupNowYandexDisk);
