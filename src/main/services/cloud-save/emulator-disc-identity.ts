import type {
  CloudSaveCustomPath,
  CloudSaveFileIdentity,
  EmulatorDiscIdentityStatus,
  Game,
} from "@types";

import { getDiscCloudSaveEmulatorProvider } from "../../../shared/cloud-save-emulator-provider.js";

type SnapshotIdentityFile = Pick<
  CloudSaveFileIdentity,
  "rawPath" | "relativePath"
>;

export interface EmulatorSaveIdentity {
  /** Save directory IDs this game may read and write. */
  savedataTitleIds: string[];
  /** Throws when a file does not belong to this game. */
  assertSnapshotFiles(
    files: SnapshotIdentityFile[],
    customPaths?: CloudSaveCustomPath[]
  ): void;
}

const discProvider = (game: Game | null | undefined) =>
  game ? getDiscCloudSaveEmulatorProvider(game.shop, game.platform) : null;

/**
 * Confirms the game's discs and returns what its saves may contain.
 * Returns null for games whose provider does not identify them by disc.
 */
export const assertEmulatorDiscIdentity = async (
  game: Game | null | undefined
): Promise<EmulatorSaveIdentity | null> => {
  switch (discProvider(game)) {
    case "rpcs3": {
      const { assertRpcs3DiscIdentity, assertRpcs3SnapshotIdentity } =
        await import("./rpcs3-game-identity.js");
      const { rpcs3SavedataTitleIdsForGame } = await import(
        "./rpcs3-title-ids.js"
      );
      const allowedTitleIds = await assertRpcs3DiscIdentity(game!);
      const savedataTitleIds = rpcs3SavedataTitleIdsForGame(
        game!,
        allowedTitleIds
      );
      const allowedSavedataTitleIds = new Set(savedataTitleIds);
      return {
        savedataTitleIds,
        assertSnapshotFiles: (files, customPaths = []) =>
          assertRpcs3SnapshotIdentity(
            files,
            allowedTitleIds,
            customPaths,
            allowedSavedataTitleIds
          ),
      };
    }
    case null:
      return null;
  }
};

export const getEmulatorDiscIdentityStatus = async (
  game: Game
): Promise<EmulatorDiscIdentityStatus | null> => {
  switch (discProvider(game)) {
    case "rpcs3": {
      const { getRpcs3DiscIdentityStatus } = await import(
        "./rpcs3-game-identity.js"
      );
      return getRpcs3DiscIdentityStatus(game);
    }
    case null:
      return null;
  }
};

/** Savedata IDs to scan without confirming the disc against the catalogue. */
export const getEmulatorSavedataTitleIds = async (
  game: Game
): Promise<string[] | undefined> => {
  switch (discProvider(game)) {
    case "rpcs3": {
      const { getRpcs3SavedataTitleIds } = await import(
        "./rpcs3-savedata-title-ids.js"
      );
      return getRpcs3SavedataTitleIds(game);
    }
    case null:
      return undefined;
  }
};

/**
 * Disc-based providers derive the save environment from emulator settings the
 * user can change at any time, so operations re-read the context first.
 */
export const emulatorRequiresFreshContext = (game: Game | null | undefined) =>
  discProvider(game) !== null;
