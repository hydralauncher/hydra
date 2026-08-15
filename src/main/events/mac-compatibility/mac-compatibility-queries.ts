import type { GameShop } from "@types";
import { logger } from "@main/services";
import {
  getMacCompatibilityManager,
  isMacCompatibilitySupported,
} from "@main/services/mac-compatibility/mac-compatibility-instance";
import type {
  MacGameCompatibility,
  MacSystemInfo,
  MacWineEnvironment,
  MacWineVersion,
} from "@main/services/mac-compatibility/MacCompatibilityTypes";
import { registerEvent } from "../register-event";

const getMacSystemInfo = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<MacSystemInfo | null> => {
  if (!isMacCompatibilitySupported()) return null;

  try {
    return await getMacCompatibilityManager().getSystemInfo();
  } catch (error) {
    logger.error("Failed to read Mac system info", { error });
    return null;
  }
};

const getMacWineVersions = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<MacWineVersion[]> => {
  if (!isMacCompatibilitySupported()) return [];

  try {
    return await getMacCompatibilityManager().getWineVersions();
  } catch (error) {
    logger.error("Failed to list Wine versions", { error });
    return [];
  }
};

const getMacGameEnvironment = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: string,
  objectId: string
): Promise<MacWineEnvironment | null> => {
  if (!isMacCompatibilitySupported()) return null;

  try {
    return await getMacCompatibilityManager().getGameEnvironment({
      shop: shop as GameShop,
      objectId,
    });
  } catch (error) {
    logger.error("Failed to read Mac game environment", { error });
    return null;
  }
};

const checkMacGameCompatibility = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: string,
  objectId: string,
  title: string,
  isWindowsGame: boolean
): Promise<MacGameCompatibility | null> => {
  if (!isMacCompatibilitySupported()) return null;

  try {
    return await getMacCompatibilityManager().checkGame(
      { shop: shop as GameShop, objectId },
      title,
      isWindowsGame
    );
  } catch (error) {
    logger.error("Failed to check Mac game compatibility", { error });
    return null;
  }
};

registerEvent("getMacSystemInfo", getMacSystemInfo);
registerEvent("getMacWineVersions", getMacWineVersions);
registerEvent("getMacGameEnvironment", getMacGameEnvironment);
registerEvent("checkMacGameCompatibility", checkMacGameCompatibility);
