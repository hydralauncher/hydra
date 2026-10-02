import { promises as fs } from "node:fs";
import path from "node:path";

import type { Game } from "@types";
import { getCloudSaveRetroArchPlatform } from "../../../shared/cloud-save-emulator-provider.js";
import { getRetroArchRomExtensions } from "../../../shared/retroarch-platform.js";

/** Transfer Pak save names are chosen by the GB ROM, not the N64 ROM. */
const isExplicitN64TransferPakSave = async (game: Game, filePath: string) => {
  if (
    getCloudSaveRetroArchPlatform(game.shop, game.platform) !== "n64" ||
    path.extname(filePath).toLowerCase() !== ".sav"
  ) {
    return false;
  }
  const extensions = new Set(getRetroArchRomExtensions("n64"));
  if (
    !(game.discs ?? []).some((disc) =>
      extensions.has(path.extname(disc.path).slice(1).toLowerCase())
    )
  ) {
    return false;
  }
  const stat = await fs.lstat(filePath).catch(() => null);
  return Boolean(stat?.isFile() && !stat.isSymbolicLink());
};

export const isEligibleEmulatorManualFile = async (
  game: Game,
  filePath: string,
  isGameSaveFile: (filePath: string) => boolean | Promise<boolean>
) =>
  (await isGameSaveFile(filePath)) ||
  (await isExplicitN64TransferPakSave(game, filePath));
