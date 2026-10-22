import { useEffect, useRef, useState } from "react";
import type { LibraryGame } from "@types";
import { getFinishedDownload } from "@shared";

const toRequestKey = (games: LibraryGame[]) =>
  games
    .filter((game) => getFinishedDownload(game))
    .map(
      (game) =>
        `${game.id}:${game.download?.folderName}:${game.download?.extracting}:${game.download?.installerLaunched}:${game.download?.installerRunning}:${Boolean(game.executablePath)}`
    )
    .join("|");

export function useInstallerAvailability(games: LibraryGame[]) {
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const gamesRef = useRef(games);
  gamesRef.current = games;

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

    void Promise.all(
      finishedGames.map(async (game) => {
        const hasInstaller = await electron
          .hasGameInstaller(game.shop, game.objectId)
          .catch(() => false);

        return [game.id, hasInstaller] as const;
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

  const storedAvailability = Object.fromEntries(
    games
      .filter((game) => game.download?.hasInstaller !== undefined)
      .map((game) => [game.id, game.download?.hasInstaller === true])
  );

  return { ...availability, ...storedAvailability };
}
