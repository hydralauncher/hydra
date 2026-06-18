import { useCallback, useEffect, useMemo, useState } from "react";
import { IS_DESKTOP } from "../constants";
import type {
  GameShop,
  GameStats,
  HowLongToBeatCategory,
  LibraryGame,
  ProtonDBData,
  ShopDetailsWithAssets,
  UserAchievement,
} from "@types";
import {
  buildFavoriteToastOptions,
  buildGameToastVisualOptions,
  resolvePreferredGameAssets,
  getSteamLanguage,
} from "../helpers";
import { useBigPictureToast } from "./use-big-picture-toast.hook";
import { NavigationAudioService } from "../services";
import { useBigPictureRunningGame } from "./use-big-picture-running-games.hook";

export function useGameDetails(objectId: string, shop: GameShop) {
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [shopDetails, setShopDetails] = useState<ShopDetailsWithAssets | null>(
    null
  );
  const [stats, setStats] = useState<GameStats | null>(null);
  const [game, setGame] = useState<LibraryGame | null>(null);
  const runningGame = useBigPictureRunningGame(game?.id);
  const isGameRunning = runningGame !== null;
  const runningSessionDurationInMillis =
    runningGame?.sessionDurationInMillis ?? null;
  const [howLongToBeat, setHowLongToBeat] = useState<
    HowLongToBeatCategory[] | null
  >(null);
  const [protonDBData, setProtonDBData] = useState<ProtonDBData | null>(null);
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const updateGame = useCallback(async () => {
    if (!IS_DESKTOP) return;
    const result = await globalThis.window.electron.getGameByObjectId(
      shop,
      objectId
    );
    setGame(result);
  }, [objectId, shop]);

  const fetchGameDetails = useCallback(
    async ({
      showLoadingState = false,
    }: { showLoadingState?: boolean } = {}) => {
      if (!IS_DESKTOP) return;

      if (showLoadingState) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const [userPreferences, statsResult, assets] = await Promise.all([
          globalThis.window.electron
            .getUserPreferences()
            .catch(() => ({ language: "en" })),
          shop === "custom"
            ? Promise.resolve(null)
            : globalThis.window.electron.getGameStats(objectId, shop),
          globalThis.window.electron.getGameAssets(objectId, shop),
        ]);

        const shopDetailsResult =
          shop === "custom"
            ? null
            : await globalThis.window.electron.getGameShopDetails(
                objectId,
                shop,
                getSteamLanguage(userPreferences?.language ?? "en")
              );

        if (shopDetailsResult) {
          shopDetailsResult.assets = assets ?? shopDetailsResult.assets;
        }

        setShopDetails(shopDetailsResult);
        setStats(statsResult);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [objectId, shop]
  );

  const refreshGameDetails = useCallback(
    async ({
      showLoadingState = false,
    }: { showLoadingState?: boolean } = {}) => {
      await Promise.all([updateGame(), fetchGameDetails({ showLoadingState })]);
    },
    [fetchGameDetails, updateGame]
  );

  useEffect(() => {
    refreshGameDetails({ showLoadingState: true }).catch(() => {});

    if (IS_DESKTOP && shop !== "custom") {
      globalThis.window.electron.hydraApi
        .get<HowLongToBeatCategory[] | null>(
          `/games/${shop}/${objectId}/how-long-to-beat`,
          { needsAuth: false }
        )
        .then(setHowLongToBeat)
        .catch(() => setHowLongToBeat(null));

      globalThis.window.electron.hydraApi
        .get<ProtonDBData | null>(`/games/${shop}/${objectId}/protondb`, {
          needsAuth: false,
        })
        .then(setProtonDBData)
        .catch(() => setProtonDBData(null));

      globalThis.window.electron
        .getUnlockedAchievements(objectId, shop)
        .then((result) => {
          if (result) {
            setAchievements(result);
          }
        })
        .catch(() => setAchievements([]));
    } else {
      setHowLongToBeat(null);
      setProtonDBData(null);
      setAchievements([]);
    }
  }, [objectId, refreshGameDetails, shop]);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    const unsubscribeLibraryBatch =
      globalThis.window.electron.onLibraryBatchComplete(() => {
        refreshGameDetails().catch(() => {});
      });

    return () => {
      unsubscribeLibraryBatch();
    };
  }, [refreshGameDetails]);

  const openGame = useCallback(
    async (discPath?: string, force?: boolean) => {
      if (!game) return;

      if (game.shop === "launchbox") {
        NavigationAudioService.getInstance().play("launch");
        await globalThis.window.electron.openClassicsGame(
          game.shop,
          game.objectId,
          discPath,
          force
        );
        return;
      }

      if (!game.executablePath) return;

      NavigationAudioService.getInstance().play("launch");
      globalThis.window.electron.openGame(
        game.shop,
        game.objectId,
        game.executablePath,
        game.launchOptions
      );
    },
    [game]
  );

  const closeGame = useCallback(() => {
    if (!game) return;
    globalThis.window.electron.closeGame(game.shop, game.objectId);
  }, [game]);

  const toggleFavorite = useCallback(async () => {
    if (!game) return;

    const preferredAssets = resolvePreferredGameAssets(
      game,
      shopDetails?.assets
    );

    const toastSource = {
      title: preferredAssets.title,
      iconUrl: preferredAssets.iconUrl,
      coverImageUrl: preferredAssets.coverImageUrl,
      libraryImageUrl: preferredAssets.libraryImageUrl,
      libraryHeroImageUrl: preferredAssets.libraryHeroImageUrl,
    };

    try {
      if (game.favorite) {
        await globalThis.window.electron.removeGameFromFavorites(
          shop,
          objectId
        );
      } else {
        await globalThis.window.electron.addGameToFavorites(shop, objectId);
      }

      await refreshGameDetails();
      globalThis.window.dispatchEvent(new Event("library-update"));
      const { title, ...toastOptions } = await buildFavoriteToastOptions(
        toastSource,
        game.favorite ? "removed" : "added"
      );
      showSuccessToast(title, toastOptions);
    } catch {
      const toastOptions = await buildGameToastVisualOptions(toastSource);
      showErrorToast("Failed to update favorites", {
        ...toastOptions,
        message: `${toastSource.title} couldn't be updated right now.`,
      });
    }
  }, [
    game,
    objectId,
    shop,
    shopDetails?.assets,
    showErrorToast,
    showSuccessToast,
    refreshGameDetails,
  ]);

  const preferredAssets = useMemo(
    () => resolvePreferredGameAssets(game, shopDetails?.assets),
    [game, shopDetails?.assets]
  );

  return {
    shopDetails,
    preferredAssets,
    stats,
    game,
    isGameRunning,
    runningSessionDurationInMillis,
    isLoading,
    isRefreshing,
    howLongToBeat,
    protonDBData,
    achievements,
    openGame,
    closeGame,
    toggleFavorite,
    updateGame,
    refreshGameDetails,
  };
}
