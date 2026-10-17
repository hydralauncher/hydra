import { useEffect, useState } from "react";
import type { LibraryGame } from "@types";
import { isSteamImportedGame } from "@renderer/helpers";

type SteamExecutableGame = Pick<
  LibraryGame,
  "shop" | "objectId" | "hasActiveSteamImport" | "executablePath"
>;

export function useIsNonSteamExecutable(
  game: SteamExecutableGame | null | undefined
) {
  const [isNonSteamExecutable, setIsNonSteamExecutable] = useState(false);

  const isSteamImport = isSteamImportedGame(game);
  const appId = game?.objectId;
  const executablePath = game?.executablePath;

  useEffect(() => {
    if (!isSteamImport || !appId || !executablePath) {
      setIsNonSteamExecutable(false);
      return;
    }

    let cancelled = false;

    globalThis.window.electron
      .isSteamAppExecutable(appId, executablePath)
      .then((isSteamExecutable) => {
        if (!cancelled) setIsNonSteamExecutable(!isSteamExecutable);
      })
      .catch(() => {
        if (!cancelled) setIsNonSteamExecutable(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isSteamImport, appId, executablePath]);

  return isNonSteamExecutable;
}
