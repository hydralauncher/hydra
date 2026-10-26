import type { LibraryGame } from "@types";
import { isGameReadyToPlay } from "@renderer/helpers";
import {
  useIsSteamLibraryExecutable,
  type SteamLibraryExecutableGame,
} from "./use-steam-library-executable";

export function useIsNonSteamExecutable(
  game: SteamLibraryExecutableGame | null | undefined,
  playedThroughGame?: LibraryGame | null
) {
  const isOutsideSteamLibrary = useIsSteamLibraryExecutable(game) === false;
  const isPlayedThroughOtherStore = Boolean(
    playedThroughGame && isGameReadyToPlay(playedThroughGame)
  );

  return isOutsideSteamLibrary && !isPlayedThroughOtherStore;
}
