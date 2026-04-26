import { useCallback, useEffect, useState } from "react";
import { IS_DESKTOP } from "../constants";
import type {
  GameShop,
  GameStats,
  HowLongToBeatCategory,
  LibraryGame,
  ShopDetailsWithAssets,
  UserAchievement,
} from "@types";

export function useGameDetails(objectId: string, shop: GameShop) {
  const [shopDetails, setShopDetails] = useState<ShopDetailsWithAssets | null>(
    null
  );
  const [stats, setStats] = useState<GameStats | null>(null);
  const [game, setGame] = useState<LibraryGame | null>(null);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [howLongToBeat, setHowLongToBeat] = useState<
    HowLongToBeatCategory[] | null
  >(null);
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const updateGame = useCallback(async () => {
    if (!IS_DESKTOP) return;
    const result = await globalThis.window.electron.getGameByObjectId(
      shop,
      objectId
    );
    setGame(result);
  }, [objectId, shop]);

  const fetchGameDetails = useCallback(async () => {
    if (!IS_DESKTOP) return;

    setIsLoading(true);

    const [shopDetailsResult, statsResult, assets] = await Promise.all([
      globalThis.window.electron.getGameShopDetails(
        objectId,
        shop,
        navigator.language
      ),
      shop === "custom"
        ? Promise.resolve(null)
        : globalThis.window.electron.getGameStats(objectId, shop),
      globalThis.window.electron.getGameAssets(objectId, shop),
    ]);

    if (shopDetailsResult) {
      shopDetailsResult.assets = assets ?? shopDetailsResult.assets;
    }

    setShopDetails(shopDetailsResult);
    setStats(statsResult);
    setIsLoading(false);
  }, [objectId, shop]);

  useEffect(() => {
    fetchGameDetails();
    updateGame();

    if (IS_DESKTOP && shop !== "custom") {
      globalThis.window.electron.hydraApi
        .get<HowLongToBeatCategory[] | null>(
          `/games/${shop}/${objectId}/how-long-to-beat`,
          { needsAuth: false }
        )
        .then(setHowLongToBeat)
        .catch(() => setHowLongToBeat(null));

      globalThis.window.electron
        .getUnlockedAchievements(objectId, shop)
        .then((result) => {
          if (result) {
            setAchievements(result);
          }
        })
        .catch(() => setAchievements([]));
    }
  }, [fetchGameDetails, updateGame, objectId, shop]);

  useEffect(() => {
    if (!IS_DESKTOP || !game?.id) return;

    const gameId = game.id;
    const unsubscribe = globalThis.window.electron.onGamesRunning(
      (gamesRunning) => {
        setIsGameRunning(gamesRunning.some((g) => g.id == gameId));
      }
    );

    return () => {
      unsubscribe();
    };
  }, [game?.id]);

  const openGame = useCallback(async () => {
    if (!game?.executablePath) return;
    globalThis.window.electron.openGame(
      game.shop,
      game.objectId,
      game.executablePath,
      game.launchOptions
    );
  }, [game]);

  const closeGame = useCallback(() => {
    if (!game) return;
    globalThis.window.electron.closeGame(game.shop, game.objectId);
  }, [game]);

  const toggleFavorite = useCallback(async () => {
    if (!game) return;

    if (game.favorite) {
      await globalThis.window.electron.removeGameFromFavorites(shop, objectId);
    } else {
      await globalThis.window.electron.addGameToFavorites(shop, objectId);
    }

    updateGame();
    globalThis.window.dispatchEvent(new Event("library-update"));
  }, [game, shop, objectId, updateGame]);

  return {
    shopDetails,
    stats,
    game,
    isGameRunning,
    isLoading,
    howLongToBeat,
    achievements,
    openGame,
    closeGame,
    toggleFavorite,
  };
}
