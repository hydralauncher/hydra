import { dialog } from "electron";
import { t } from "i18next";

import { WindowManager } from "@main/services/window-manager";
import type { Game, RestoreManifestFile } from "@types";
import { getCloudSaveEmulatorProvider } from "@shared";

import { cloudSaveFileKey } from "./cloud-save-contract";
import {
  isEmulatorStateFile,
  stateFilesRequiringConfirmation,
} from "./state-restore-policy";

const getInstalledStateVersion = async (game: Game) => {
  if (getCloudSaveEmulatorProvider(game.shop, game.platform) === "retroarch") {
    const { getRetroArchInstalledCoreVersion, retroArchStateMetadataForGame } =
      await import("./retroarch-save-provider");
    const [origin, version] = await Promise.all([
      retroArchStateMetadataForGame(game),
      getRetroArchInstalledCoreVersion(game),
    ]);
    return origin && version ? { ...origin, version } : null;
  }
  return null;
};

/** Rejecting a state leaves ordinary saves eligible for the same restore. */
export const approveEmulatorStateRestore = async (
  game: Game | null | undefined,
  files: RestoreManifestFile[]
): Promise<Set<string>> => {
  if (!game || !files.some(isEmulatorStateFile)) return new Set();
  const installed = await getInstalledStateVersion(game).catch(() => null);
  const uncertain = stateFilesRequiringConfirmation(game, files, installed);
  if (uncertain.length === 0) return new Set();

  const options = {
    type: "warning" as const,
    title: t("cloud_save_v2_state_restore_title", { ns: "game_details" }),
    message: t("cloud_save_v2_state_restore_message", {
      ns: "game_details",
      count: uncertain.length,
    }),
    detail: t("cloud_save_v2_state_restore_detail", {
      ns: "game_details",
    }),
    buttons: [
      t("cloud_save_v2_state_restore_skip", { ns: "game_details" }),
      t("cloud_save_v2_state_restore_confirm", { ns: "game_details" }),
    ],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const owner = WindowManager.mainWindow;
  const response = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options);
  return response.response === 1
    ? new Set()
    : new Set(uncertain.map(cloudSaveFileKey));
};
