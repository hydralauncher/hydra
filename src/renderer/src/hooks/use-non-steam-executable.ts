import {
  useIsSteamLibraryExecutable,
  type SteamLibraryExecutableGame,
} from "./use-steam-library-executable";

export function useIsNonSteamExecutable(
  game: SteamLibraryExecutableGame | null | undefined
) {
  return useIsSteamLibraryExecutable(game) === false;
}
