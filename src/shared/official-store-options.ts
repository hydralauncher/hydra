import type { EpicConnectionState, LibraryGame } from "@types";

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
