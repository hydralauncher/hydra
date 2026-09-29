import type { CloudSaveRule, Game, RestoreManifestFile } from "@types";
import { getCloudSaveEmulatorProvider } from "../../../shared/cloud-save-emulator-provider.js";

import {
  emulatorDefaultVariant,
  emulatorSaveFileKey,
} from "./emulator-provider-identity.js";
import type { EmulatorProvider } from "./emulator-provider-types";

export const getEmulatorSaveProvider = (game?: Game | null) =>
  game ? getCloudSaveEmulatorProvider(game.shop, game.platform) : null;

export const getEmulatorGameSaveFileFilter = async (game: Game) => {
  const provider = getEmulatorSaveProvider(game);
  if (provider === "retroarch") {
    const { getRetroArchGameSaveFileFilter } = await import(
      "./retroarch-save-provider"
    );
    return getRetroArchGameSaveFileFilter(game);
  }
  if (provider === "rpcs3") {
    const { isRpcs3GameSaveFile } = await import("./rpcs3-save-layout");
    return (filePath: string) => isRpcs3GameSaveFile(game, filePath);
  }
  if (provider === "duckstation") {
    const { getDuckstationGameSaveFileFilter } = await import(
      "./duckstation-save-provider"
    );
    return getDuckstationGameSaveFileFilter(game);
  }
  if (provider === "pcsx2") {
    const { getPcsx2GameSaveFileFilter } = await import(
      "./pcsx2-save-provider"
    );
    return getPcsx2GameSaveFileFilter(game);
  }
  if (provider === "ppsspp") {
    const { getPpssppGameSaveFileFilter } = await import(
      "./ppsspp-save-provider"
    );
    return getPpssppGameSaveFileFilter(game);
  }
  if (provider === "dolphin") {
    const { getDolphinGameSaveFileFilter } = await import(
      "./dolphin-save-provider"
    );
    return getDolphinGameSaveFileFilter(game);
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
    case "duckstation":
      return (await import("./duckstation-save-provider"))
        .duckstationSaveProvider;
    case "pcsx2":
      return (await import("./pcsx2-save-provider")).pcsx2SaveProvider;
    case "ppsspp":
      return (await import("./ppsspp-save-provider")).ppssppSaveProvider;
    case "dolphin":
      return (await import("./dolphin-save-provider")).dolphinSaveProvider;
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
  if (provider === "duckstation") {
    const { getDuckstationSaveEnvironmentKey } = await import(
      "./duckstation-save-provider"
    );
    return getDuckstationSaveEnvironmentKey(game);
  }
  if (provider === "pcsx2") {
    const { getPcsx2SaveEnvironmentKey } = await import(
      "./pcsx2-save-provider"
    );
    return getPcsx2SaveEnvironmentKey(game);
  }
  if (provider === "ppsspp") {
    const { getPpssppSaveEnvironmentKey } = await import(
      "./ppsspp-save-provider"
    );
    return getPpssppSaveEnvironmentKey(game);
  }
  if (provider === "dolphin") {
    const { getDolphinSaveEnvironmentKey } = await import(
      "./dolphin-save-provider"
    );
    return getDolphinSaveEnvironmentKey(game);
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
