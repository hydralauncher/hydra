import type { CloudSaveRule, Game, RestoreManifestFile } from "@types";
import { getCloudSaveEmulatorProvider } from "../../../shared/cloud-save-emulator-provider.js";

import {
  emulatorDefaultVariant,
  emulatorSaveFileKey,
} from "./emulator-provider-identity.js";
import type { EmulatorProvider } from "./emulator-provider-types";

export const getEmulatorSaveProvider = (game?: Game | null) =>
  game ? getCloudSaveEmulatorProvider(game.shop, game.platform) : null;

const loadProvider = async (
  provider: NonNullable<ReturnType<typeof getEmulatorSaveProvider>>
): Promise<EmulatorProvider> =>
  provider === "rpcs3"
    ? (await import("./rpcs3-save-provider")).rpcs3SaveProvider
    : (await import("./retroarch-save-provider")).retroArchSaveProvider;

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
  environmentId: string
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
    }),
  };
};

export const getEmulatorRestoreRules = async (
  game: Game | null | undefined,
  files: RestoreManifestFile[]
) => {
  const provider = getEmulatorSaveProvider(game);
  if (!provider || !game || files.length === 0) {
    return new Map<string, CloudSaveRule>();
  }
  return (await loadProvider(provider)).restoreRules(game, files);
};

export { emulatorSaveFileKey };
