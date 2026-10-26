import { useEffect, useState } from "react";
import type { LibraryGame } from "@types";

export type SteamLibraryExecutableGame = Pick<
  LibraryGame,
  "shop" | "objectId" | "hasActiveSteamImport" | "executablePath"
>;

interface SteamLibraryExecutableCheck {
  key: string;
  value: boolean;
}

const pendingExecutableChecks = new Map<string, Promise<boolean>>();

const checkSteamLibraryExecutable = (
  checkKey: string,
  objectId: string,
  executablePath: string
) => {
  const pending = pendingExecutableChecks.get(checkKey);
  if (pending !== undefined) return pending;

  const check = globalThis.window.electron
    .isSteamAppExecutable(objectId, executablePath)
    .finally(() => pendingExecutableChecks.delete(checkKey));

  pendingExecutableChecks.set(checkKey, check);
  return check;
};

export const getSteamLibraryExecutableCheckKey = (
  game: SteamLibraryExecutableGame | null | undefined,
  enabled = true
) => {
  const shop = game?.shop;
  const objectId = game?.objectId;
  const hasActiveSteamImport = game?.hasActiveSteamImport;
  const executablePath = game?.executablePath;

  return enabled &&
    shop === "steam" &&
    hasActiveSteamImport &&
    objectId &&
    executablePath
    ? JSON.stringify([objectId, executablePath])
    : null;
};

export function useIsSteamLibraryExecutable(
  game: SteamLibraryExecutableGame | null | undefined,
  enabled = true
) {
  const [checked, setChecked] = useState<SteamLibraryExecutableCheck | null>(
    null
  );

  const objectId = game?.objectId;
  const executablePath = game?.executablePath;
  const checkKey = getSteamLibraryExecutableCheckKey(game, enabled);

  useEffect(() => {
    if (!checkKey || !objectId || !executablePath) {
      setChecked(null);
      return;
    }

    let cancelled = false;

    checkSteamLibraryExecutable(checkKey, objectId, executablePath)
      .then((isSteamExecutable) => {
        if (!cancelled) {
          setChecked({ key: checkKey, value: isSteamExecutable });
        }
      })
      .catch(() => {
        if (!cancelled) setChecked({ key: checkKey, value: false });
      });

    return () => {
      cancelled = true;
    };
  }, [checkKey, objectId, executablePath]);

  if (!enabled || !checkKey) return null;
  return checked?.key === checkKey ? checked.value : null;
}
