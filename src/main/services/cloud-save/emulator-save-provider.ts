import type { CloudSaveRule, Game, RestoreManifestFile } from "@types";
import { getCloudSaveEmulatorProvider } from "../../../shared/cloud-save-emulator-provider.js";

import {
  emulatorDefaultVariant,
  emulatorSaveFileKey,
} from "./emulator-provider-identity.js";
import type { EmulatorProvider } from "./emulator-provider-types";

export const getEmulatorSaveProvider = (game?: Game | null) =>
  game ? getCloudSaveEmulatorProvider(game.shop, game.platform) : null;

export const getEmulatorGameSaveFileFilter = async (
  game: Game,
  rpcs3SavedataTitleIds?: readonly string[]
) => {
  const provider = getEmulatorSaveProvider(game);
  if (provider === "retroarch") {
    const { getRetroArchGameSaveFileFilter } = await import(
      "./retroarch-save-provider"
    );
    return getRetroArchGameSaveFileFilter(game);
  }
  if (provider === "rpcs3") {
    const { isRpcs3GameSaveFile } = await import("./rpcs3-save-layout");
    const { getRpcs3SavedataTitleIds } = await import(
      "./rpcs3-savedata-title-ids.js"
    );
    const titleIds =
      rpcs3SavedataTitleIds ?? (await getRpcs3SavedataTitleIds(game));
    return (filePath: string) => isRpcs3GameSaveFile(game, filePath, titleIds);
  }
  return () => false;
};

const loadProvider = async (
  provider: NonNullable<ReturnType<typeof getEmulatorSaveProvider>>
): Promise<EmulatorProvider> => {
  switch (provider) {
    case "rpcs3":
      return (await import("./rpcs3-save-provider")).rpcs3SaveProvider;
    case "retroarch":
      return (await import("./retroarch-save-provider")).retroArchSaveProvider;
  }
};

export const getEmulatorSaveEnvironmentKey = async (game: Game) => {
  const provider = getEmulatorSaveProvider(game);
  if (provider === "rpcs3") {
    const { getRpcs3SaveEnvironmentKey } = await import(
      "./rpcs3-save-provider"
    );
    return getRpcs3SaveEnvironmentKey(game);
  }
  if (provider === "retroarch") {
    const { getRetroArchSaveEnvironmentKey } = await import(
      "./retroarch-save-provider"
    );
    return getRetroArchSaveEnvironmentKey(game);
  }
  return null;
};

export const discoverEmulatorSaveFiles = async (
  game: Game,
  environmentId: string,
  remoteFiles: RestoreManifestFile[] = [],
  rpcs3SavedataTitleIds?: readonly string[]
) => {
  const provider = getEmulatorSaveProvider(game);
  if (!provider) throw new Error("cloud_save_emulator_provider_unavailable");
  const variant = emulatorDefaultVariant(game.shop, game.objectId);
  return {
    variant,
    discovery: await (
      await loadProvider(provider)
    ).discover({
      game,
      environmentId,
      variantId: variant.variantId,
      remoteFiles,
      rpcs3SavedataTitleIds,
    }),
  };
};

export const getEmulatorRestoreRules = async (
  game: Game | null | undefined,
  files: RestoreManifestFile[],
  rpcs3SavedataTitleIds?: readonly string[]
) => {
  const provider = getEmulatorSaveProvider(game);
  if (!provider || !game || files.length === 0) {
    return new Map<string, CloudSaveRule>();
  }
  return (await loadProvider(provider)).restoreRules(
    game,
    files,
    rpcs3SavedataTitleIds
  );
};

export { emulatorSaveFileKey };
