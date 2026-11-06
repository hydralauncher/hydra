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

export const getEpicMemberDownload = (
  member: LibraryGame | null,
  downloadGame: LibraryGame | null | undefined
) => {
  if (!member) return null;
  if (
    downloadGame?.shop === member.shop &&
    downloadGame.objectId === member.objectId
  )
    return downloadGame.download;
  return member.download;
};

const EPIC_UPDATE_STOPPED_STATUSES = new Set(["paused", "error", "removed"]);

export const isEpicUpdateInterrupted = (
  download: {
    status?: string | null;
    queued?: boolean;
    extracting?: boolean;
    epic?: { update?: { filesChanged?: boolean } | null };
  } | null
) =>
  !!download?.epic?.update?.filesChanged &&
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

export interface EpicInstallChoice {
  components?: string[];
  dlcs: string[];
  downloadSizeInBytes: number | null;
  diskSizeInBytes: number | null;
}

export const getEpicInstallChoice = (
  option: EpicGameInstallOption | null,
  excludedComponents: ReadonlySet<string>,
  excludedDlcs: ReadonlySet<string>
): EpicInstallChoice => {
  if (!option)
    return { dlcs: [], downloadSizeInBytes: null, diskSizeInBytes: null };
  const packs = (option.components ?? []).filter(
    (component) => !excludedComponents.has(component.id)
  );
  const dlcs = (option.dlcs ?? []).filter(
    (dlc) => !dlc.installed && !excludedDlcs.has(dlc.artifactId)
  );
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const partial =
    !!option.components && packs.length < option.components.length;
  const gameInstalled =
    option.installed &&
    !!option.installedVersion &&
    option.installedVersion === option.publishedVersion;
  const gameBytes = (
    required: number | null | undefined,
    packBytes: number,
    full: number | null | undefined
  ) => {
    if (gameInstalled) return 0;
    if (partial) return (required ?? 0) + packBytes;
    return full ?? null;
  };
  const gameDownload = gameBytes(
    option.requiredDownloadSizeInBytes,
    sum(packs.map((pack) => pack.downloadSizeInBytes)),
    option.downloadSizeInBytes
  );
  const gameDisk = gameBytes(
    option.requiredDiskSizeInBytes,
    sum(packs.map((pack) => pack.diskSizeInBytes)),
    option.diskSizeInBytes
  );
  return {
    ...(option.components ? { components: packs.map((pack) => pack.id) } : {}),
    dlcs: dlcs.map((dlc) => dlc.artifactId),
    downloadSizeInBytes:
      gameDownload === null
        ? null
        : gameDownload + sum(dlcs.map((dlc) => dlc.downloadSizeInBytes)),
    diskSizeInBytes:
      gameDisk === null
        ? null
        : gameDisk + sum(dlcs.map((dlc) => dlc.diskSizeInBytes)),
  };
};
