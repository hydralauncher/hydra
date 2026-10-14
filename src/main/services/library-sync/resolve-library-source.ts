export type LibrarySource = "hydra" | "steam" | "epic";

const isLibrarySource = (value: unknown): value is LibrarySource =>
  value === "hydra" || value === "steam" || value === "epic";

export const resolveLibrarySource = (
  localSource?: string | null,
  remoteSource?: string | null
): LibrarySource => {
  if (localSource === "hydra" || remoteSource === "hydra") {
    return "hydra";
  }

  if (localSource === "steam" || remoteSource === "steam") {
    return "steam";
  }

  if (isLibrarySource(localSource)) return localSource;
  if (isLibrarySource(remoteSource)) return remoteSource;

  return "hydra";
};

export const resolveLibraryIsDeleted = (
  localIsDeleted: boolean,
  remoteSource?: string | null,
  hasActiveSteamImport = false,
  hasActiveEpicImport = false
): boolean =>
  remoteSource === "steam" ||
  remoteSource === "epic" ||
  hasActiveSteamImport ||
  hasActiveEpicImport
    ? false
    : localIsDeleted;

export const resolveMissingSteamImport = (
  game: { shop: string; hasActiveSteamImport?: boolean },
  existsRemotely: boolean
) => {
  if (
    game.shop !== "steam" ||
    game.hasActiveSteamImport !== true ||
    existsRemotely
  ) {
    return null;
  }

  return {
    hasActiveSteamImport: false as const,
    isDeleted: true as const,
  };
};
