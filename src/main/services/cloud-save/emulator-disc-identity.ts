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
  savedataTitleIds: string[];
  assertSnapshotFiles(
    files: SnapshotIdentityFile[],
    customPaths?: CloudSaveCustomPath[]
  ): void;
}

const discProvider = (game: Game) =>
  getDiscCloudSaveEmulatorProvider(game.shop, game.platform);

export const assertEmulatorDiscIdentity = async (
  game: Game | null | undefined
): Promise<EmulatorSaveIdentity | null> => {
  if (!game) return null;
  switch (discProvider(game)) {
    case "rpcs3": {
      const { assertRpcs3DiscIdentity, assertRpcs3SnapshotIdentity } =
        await import("./rpcs3-game-identity.js");
      const { rpcs3SavedataTitleIdsForGame } = await import(
        "./rpcs3-title-ids.js"
      );
      const allowedTitleIds = await assertRpcs3DiscIdentity(game);
      const savedataTitleIds = rpcs3SavedataTitleIdsForGame(
        game,
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

export const emulatorRequiresFreshContext = (game: Game | null | undefined) =>
  game ? discProvider(game) !== null : false;
