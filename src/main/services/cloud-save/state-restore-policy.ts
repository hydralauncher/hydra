import type { Game, RestoreManifestFile } from "@types";
import { getCloudSaveEmulatorProvider } from "../../../shared/cloud-save-emulator-provider.js";

export const isEmulatorStateFile = (file: RestoreManifestFile) =>
  Boolean(file.stateMetadata) ||
  /(?:^|\/)[^/]+\.state(?:\d+|\.auto)?(?:\.png)?$/i.test(file.relativePath) ||
  /\.SAVESTAT(?:\.zst|\.gz)?$/i.test(file.relativePath) ||
  file.rawPath.startsWith("<emulator>/rpcs3-state/");

export const stateFilesRequiringConfirmation = (
  game: Game | null | undefined,
  files: RestoreManifestFile[],
  installed: { emulatorId: string; coreId?: string; version?: string } | null
) => {
  if (!game || !getCloudSaveEmulatorProvider(game.shop, game.platform)) {
    return [];
  }
  return files.filter((file) => {
    if (!isEmulatorStateFile(file)) return false;
    const origin = file.stateMetadata;
    return (
      !origin?.version ||
      !installed?.version ||
      origin.version !== installed.version ||
      origin.emulatorId !== installed.emulatorId ||
      (origin.coreId !== undefined && origin.coreId !== installed.coreId)
    );
  });
};
