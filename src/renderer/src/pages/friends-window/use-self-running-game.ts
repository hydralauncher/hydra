import { useEffect, useState } from "react";
import type { GameRunning, GameShop } from "@types";
import { resolveImageSource } from "@renderer/helpers";

export interface SelfRunningGame {
  title: string;
  iconUrl: string | null;
  shop: GameShop;
}

type RunningEntry = Pick<GameRunning, "id" | "sessionDurationInMillis">;

const splitGameKey = (gameKey: string) => {
  const separatorIndex = gameKey.indexOf(":");
  return {
    shop: gameKey.slice(0, separatorIndex) as GameShop,
    objectId: gameKey.slice(separatorIndex + 1),
  };
};

export function useSelfRunningGame() {
  const [selfGame, setSelfGame] = useState<SelfRunningGame | null>(null);

  useEffect(() => {
    let isCancelled = false;
    let currentGameKey: string | null = null;

    const resolveRunningGame = async (gamesRunning: RunningEntry[]) => {
      const lastGame = gamesRunning.at(-1);

      if (!lastGame) {
        currentGameKey = null;
        setSelfGame(null);
        return;
      }

      if (lastGame.id === currentGameKey) return;
      currentGameKey = lastGame.id;

      const { shop, objectId } = splitGameKey(lastGame.id);
      const game = await globalThis.window.electron
        .getGameByObjectId(shop, objectId)
        .catch(() => null);

      if (isCancelled || currentGameKey !== lastGame.id) return;

      if (!game || game.isConcealed) {
        setSelfGame(null);
        return;
      }

      const iconSource =
        game.customIconUrl ?? game.iconUrl ?? game.libraryImageUrl ?? null;

      setSelfGame({
        title: game.title,
        iconUrl: iconSource ? resolveImageSource(iconSource) : null,
        shop: game.shop,
      });
    };

    void globalThis.window.electron
      .getGamesRunning()
      .then(resolveRunningGame)
      .catch(() => {});
    const unsubscribe =
      globalThis.window.electron.onGamesRunning(resolveRunningGame);

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, []);

  return selfGame;
}
