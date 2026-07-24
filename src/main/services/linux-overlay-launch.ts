import type { Game, UserPreferences } from "@types";

export const prepareLinuxOverlayLaunch = (
  _game: Game | undefined,
  _preferences: UserPreferences | null,
  mangohudAvailable: boolean,
  mangohudRequestedByUser: boolean
) => {
  return {
    useMangohud: mangohudRequestedByUser && mangohudAvailable,
    environment: {} as Record<string, string>,
  };
};
