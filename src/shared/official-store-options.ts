import type {
  EpicConnectionState,
  EpicGameInstallOption,
  EpicInstallation,
  EpicLaunchOptions,
  LibraryGame,
} from "@types";

/** Catalogue availability does not prove that the current account owns a copy. */
export const getOfficialStoreMembers = (members: readonly LibraryGame[]) => {
  const active = members.filter((game) => !game.isDeleted);
  return {
    steam:
      active.find(
        (game) => game.shop === "steam" && game.hasActiveSteamImport === true
      ) ?? null,
    epic:
      active.find(
        (game) => game.shop === "epic" && game.hasActiveEpicImport === true
      ) ?? null,
  };
};

export const isEpicMemberInCurrentScope = (
  game: LibraryGame | null,
  state: EpicConnectionState | null
) =>
  !!game?.epicImportScope &&
  state?.verification === "confirmed" &&
  state.availability.available &&
  state.connection?.connected === true &&
  game.epicImportScope.userId === state.hydraUserId &&
  game.epicImportScope.connectionId === state.connection.connectionId;

export const getInstalledStoreMembers = (members: readonly LibraryGame[]) => {
  const seen = new Set<string>();
  return members
    .filter((member) => {
      const key = `${member.shop}:${member.objectId}`;
      if (member.isDeleted || !member.executablePath || seen.has(key))
        return false;
      seen.add(key);
      return (
        member.shop === "steam" ||
        (member.shop === "epic" && !!member.epicInstallation)
      );
    })
    .sort((a, b) => Number(b.shop === "steam") - Number(a.shop === "steam"));
};

export const getEpicGameUpdate = (
  options: readonly EpicGameInstallOption[],
  installation: Pick<EpicInstallation, "artifactId" | "platform"> | null
): EpicGameInstallOption | null => {
  if (!installation) return null;
  return (
    options.find(
      (option) =>
        option.artifactId === installation.artifactId &&
        option.platform === installation.platform &&
        option.installed &&
        !!option.publishedVersion &&
        !!option.installedVersion &&
        option.publishedVersion !== option.installedVersion
    ) ?? null
  );
};

const EPIC_UPDATE_STOPPED_STATUSES = new Set(["paused", "error", "removed"]);

export const isEpicUpdateInterrupted = (
  download: {
    status?: string | null;
    queued?: boolean;
    extracting?: boolean;
    epic?: { update?: unknown };
  } | null
) =>
  !!download?.epic?.update &&
  !download.queued &&
  !download.extracting &&
  EPIC_UPDATE_STOPPED_STATUSES.has(download.status ?? "");

export const getEpicLaunchOptions = (
  localOnce: boolean,
  offline: boolean,
  skipUpdateCheck = false
): EpicLaunchOptions | undefined => {
  if (offline) return { epicOffline: true };
  if (!localOnce && !skipUpdateCheck) return undefined;
  return {
    ...(localOnce ? { epicSavePolicy: "local-once" as const } : {}),
    ...(skipUpdateCheck ? { epicSkipUpdateCheck: true } : {}),
  };
};
