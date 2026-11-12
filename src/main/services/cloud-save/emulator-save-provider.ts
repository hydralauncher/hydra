import type {
  CloudSaveRule,
  Game,
  ResolvedRestoreTarget,
  RestoreManifestFile,
} from "@types";
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
  savedataTitleIds?: readonly string[]
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
    const titleIds = savedataTitleIds ?? (await getRpcs3SavedataTitleIds(game));
    return (filePath: string) => isRpcs3GameSaveFile(game, filePath, titleIds);
  }
  if (provider === "shadps4") {
    const { getShadps4SavedataTitleIds, isShadps4GameSaveFile } = await import(
      "./shadps4-save-layout.js"
    );
    const titleIds =
      savedataTitleIds ?? (await getShadps4SavedataTitleIds(game));
    return (filePath: string) => isShadps4GameSaveFile(filePath, titleIds);
  }
  return () => false;
};

const loadProvider = async (
  provider: NonNullable<ReturnType<typeof getEmulatorSaveProvider>>
): Promise<EmulatorProvider> => {
  switch (provider) {
    case "rpcs3":
      return (await import("./rpcs3-save-provider")).rpcs3SaveProvider;
    case "shadps4":
      return (await import("./shadps4-save-provider")).shadps4SaveProvider;
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
    return getRpcs3SaveEnvironmentKey();
  }
  if (provider === "shadps4") {
    const { getShadps4SaveEnvironmentKey } = await import(
      "./shadps4-save-provider"
    );
    return getShadps4SaveEnvironmentKey();
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
  savedataTitleIds?: readonly string[]
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
      savedataTitleIds,
    }),
  };
};

export const getEmulatorRestoreRules = async (
  game: Game | null | undefined,
  files: RestoreManifestFile[],
  savedataTitleIds?: readonly string[]
) => {
  const provider = getEmulatorSaveProvider(game);
  if (!provider || !game || files.length === 0) {
    return new Map<string, CloudSaveRule>();
  }
  return (await loadProvider(provider)).restoreRules(
    game,
    files,
    savedataTitleIds
  );
};

export const finalizeEmulatorRestore = async (
  game: Game | null | undefined,
  actions: ResolvedRestoreTarget[]
) => {
  const provider = getEmulatorSaveProvider(game);
  if (!provider || actions.length === 0) return;
  await (await loadProvider(provider)).afterRestore?.(actions);
};

export { emulatorSaveFileKey };
