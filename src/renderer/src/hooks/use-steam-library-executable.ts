import { useEffect, useState } from "react";
import type { LibraryGame } from "@types";

type SteamLibraryExecutableGame = Pick<
  LibraryGame,
  "shop" | "objectId" | "hasActiveSteamImport" | "executablePath"
>;

export function useIsSteamLibraryExecutable(
  game: SteamLibraryExecutableGame | null | undefined
) {
  const [isSteamLibraryExecutable, setIsSteamLibraryExecutable] = useState<
    boolean | null
  >(null);

  const shop = game?.shop;
  const objectId = game?.objectId;
  const hasActiveSteamImport = game?.hasActiveSteamImport;
  const executablePath = game?.executablePath;

  useEffect(() => {
    if (
      shop !== "steam" ||
      !hasActiveSteamImport ||
      !objectId ||
      !executablePath
    ) {
      setIsSteamLibraryExecutable(null);
      return;
    }

    let cancelled = false;

    globalThis.window.electron
      .isSteamAppExecutable(objectId, executablePath)
      .then((isSteamExecutable) => {
        if (!cancelled) setIsSteamLibraryExecutable(isSteamExecutable);
      })
      .catch(() => {
        if (!cancelled) setIsSteamLibraryExecutable(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shop, objectId, hasActiveSteamImport, executablePath]);

  return isSteamLibraryExecutable;
}
