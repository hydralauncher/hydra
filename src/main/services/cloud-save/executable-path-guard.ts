import type { Game, GameShop } from "@types";

export const CLOUD_SAVE_EXECUTABLE_MISSING_ERROR =
  "cloud_save_executable_missing";

export const isCloudSaveExecutableMissingError = (error: unknown) =>
  error instanceof Error &&
  error.message === CLOUD_SAVE_EXECUTABLE_MISSING_ERROR;

interface CloudSaveExecutableGuardDependencies {
  getGame: (objectId: string, shop: GameShop) => Promise<Game | undefined>;
  saveGame: (game: Game) => Promise<void>;
  pathExists: (executablePath: string) => Promise<boolean>;
  onExecutablePathCleared: (
    game: Game,
    executablePath: string
  ) => Promise<void> | void;
}

export const createCloudSaveExecutableGuard = ({
  getGame,
  saveGame,
  pathExists,
  onExecutablePathCleared,
}: CloudSaveExecutableGuardDependencies) => {
  const assertGameExecutableExists = async (
    game: Game | undefined,
    objectId: string,
    shop: GameShop
  ): Promise<Game> => {
    const executablePath = game?.executablePath;
    if (!game || !executablePath) {
      throw new Error(CLOUD_SAVE_EXECUTABLE_MISSING_ERROR);
    }
    if (await pathExists(executablePath)) return game;

    const currentGame = await getGame(objectId, shop);
    if (currentGame?.executablePath !== executablePath) {
      return assertGameExecutableExists(currentGame, objectId, shop);
    }

    const clearedGame: Game = {
      ...currentGame,
      executablePath: null,
      executablePathUpdatedAt: null,
      installedSizeInBytes: null,
    };
    await saveGame(clearedGame);
    await onExecutablePathCleared(clearedGame, executablePath);
    throw new Error(CLOUD_SAVE_EXECUTABLE_MISSING_ERROR);
  };

  return async (objectId: string, shop: GameShop) =>
    assertGameExecutableExists(await getGame(objectId, shop), objectId, shop);
};
