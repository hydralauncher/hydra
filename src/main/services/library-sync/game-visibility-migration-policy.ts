import type { Game } from "@types";

type LegacyGameVisibility = Game & {
  hide?: boolean;
  isHidden?: boolean;
};

export interface GameVisibilityMigrationStore {
  getCompleted: () => Promise<boolean>;
  getGames: () => Promise<[string, Game][]>;
  commit: (games: [string, Game][]) => Promise<void>;
}

export const migrateGameVisibilityWithStore = async (
  store: GameVisibilityMigrationStore
) => {
  if (await store.getCompleted()) return false;

  const gamesToUpdate: [string, Game][] = (await store.getGames())
    .filter(([, game]) => "hide" in game || "isHidden" in game)
    .map(([key, game]) => {
      const { hide, isHidden, ...rest } = game as LegacyGameVisibility;
      return [
        key,
        {
          ...rest,
          isHiddenFromOthers: rest.isHiddenFromOthers ?? hide ?? false,
          isConcealed: rest.isConcealed ?? isHidden ?? false,
        },
      ];
    });

  await store.commit(gamesToUpdate);
  return true;
};
