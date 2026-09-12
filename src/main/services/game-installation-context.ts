import type { Game } from "../../types/level.types.js";
import type { GameInstallation } from "../../types/level.types.js";

export const installationFields = [
  "executablePath",
  "executablePathUpdatedAt",
  "trackingExecutablePaths",
  "trackingExecutablePathsUpdatedAt",
  "winePrefixPath",
  "protonPath",
  "launchOptions",
  "autoRunMangohud",
  "autoRunGamemode",
  "automaticCloudSync",
  "installedSizeInBytes",
  "installerSizeInBytes",
] as const;

export const getLegacyInstallationId = (shop: Game["shop"], objectId: string) =>
  `legacy:${shop}:${objectId}`;

export const buildGameInstallation = (
  game: Game,
  installationId: string,
  current?: GameInstallation
): GameInstallation => ({
  installationId,
  canonicalGameId: game.canonicalGameId ?? current?.canonicalGameId ?? null,
  storeMappingId: game.storeMappingId ?? current?.storeMappingId ?? null,
  shop: game.shop,
  objectId: game.objectId,
  executablePath: game.executablePath ?? current?.executablePath ?? null,
  executablePathUpdatedAt:
    game.executablePathUpdatedAt ?? current?.executablePathUpdatedAt ?? null,
  trackingExecutablePaths:
    game.trackingExecutablePaths ?? current?.trackingExecutablePaths ?? null,
  trackingExecutablePathsUpdatedAt:
    game.trackingExecutablePathsUpdatedAt ??
    current?.trackingExecutablePathsUpdatedAt ??
    null,
  winePrefixPath: game.winePrefixPath ?? current?.winePrefixPath ?? null,
  protonPath: game.protonPath ?? current?.protonPath ?? null,
  launchOptions: game.launchOptions ?? current?.launchOptions ?? null,
  autoRunMangohud: game.autoRunMangohud ?? current?.autoRunMangohud ?? null,
  autoRunGamemode: game.autoRunGamemode ?? current?.autoRunGamemode ?? null,
  automaticCloudSync:
    game.automaticCloudSync ?? current?.automaticCloudSync ?? null,
  installedSizeInBytes:
    game.installedSizeInBytes ?? current?.installedSizeInBytes ?? null,
  installerSizeInBytes:
    game.installerSizeInBytes ?? current?.installerSizeInBytes ?? null,
});

export const applyGameInstallation = (
  game: Game,
  installation: GameInstallation
): Game => ({
  ...game,
  installationId: installation.installationId,
  canonicalGameId: installation.canonicalGameId,
  storeMappingId: installation.storeMappingId,
  ...Object.fromEntries(
    installationFields.map((field) => [field, installation[field]])
  ),
});
