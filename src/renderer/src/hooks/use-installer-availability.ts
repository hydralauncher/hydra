import { useEffect, useRef, useState } from "react";
import type { LibraryGame } from "@types";
import { getFinishedDownload } from "@shared";

interface LiveAvailability {
  folderKey: string;
  hasInstaller: boolean;
}

const toFolderKey = (game: LibraryGame) =>
  `${game.download?.folderName}:${game.download?.extracting}`;

const toRequestKey = (games: LibraryGame[]) =>
  games
    .filter((game) => getFinishedDownload(game))
    .map(
      (game) =>
        `${game.id}:${game.download?.folderName}:${game.download?.extracting}:${game.download?.installerLaunched}:${game.download?.installerRunning}:${Boolean(game.executablePath)}`
    )
    .join("|");

export function useInstallerAvailability(games: LibraryGame[]) {
  const [availability, setAvailability] = useState<
    Record<string, LiveAvailability>
  >({});
  const gamesRef = useRef(games);
  gamesRef.current = games;
  const availabilityRef = useRef(availability);
  availabilityRef.current = availability;

  const requestKey = toRequestKey(games);

  useEffect(() => {
    const electron = globalThis.window?.electron;
    if (!electron) return;

    let cancelled = false;

    const finishedGames = gamesRef.current.filter((game) =>
      getFinishedDownload(game)
    );

    finishedGames
      .filter(
        (game) =>
          game.download?.installerLaunched &&
          !game.download.installerRunning &&
          !game.executablePath
      )
      .forEach((game) => {
        void electron
          .recheckInstalledExecutable(game.shop, game.objectId)
          .catch(() => false);
      });

    const gamesToCheck = finishedGames.filter(
      (game) =>
        availabilityRef.current[game.id]?.folderKey !== toFolderKey(game)
    );

    if (gamesToCheck.length === 0) return;

    void Promise.all(
      gamesToCheck.map(async (game) => {
        const hasInstaller = await electron
          .hasGameInstaller(game.shop, game.objectId)
          .catch(() => false);

        return [
          game.id,
          { folderKey: toFolderKey(game), hasInstaller },
        ] as const;
      })
    ).then((results) => {
      if (cancelled) return;

      setAvailability((previous) => ({
        ...previous,
        ...Object.fromEntries(results),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const result: Record<string, boolean> = {};

  for (const game of games) {
    const live = availability[game.id];

    if (live?.folderKey === toFolderKey(game)) {
      result[game.id] = live.hasInstaller;
    } else if (game.download?.hasInstaller !== undefined) {
      result[game.id] = game.download.hasInstaller;
    }
  }

  return result;
}
