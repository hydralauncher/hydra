import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
} from "../helpers";
import { useBigPictureToast } from "./use-big-picture-toast.hook";
import { NavigationAudioService } from "../services";
import { useBigPictureRunningGame } from "./use-big-picture-running-games.hook";
import { useUserPreferences } from "./use-user-preferences.hook";

export function useGameDetails(objectId: string, shop: GameShop) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
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
  const userPreferences = useUserPreferences();
  const shouldUseRetroAchievements =
    shop === "launchbox" &&
    Boolean(userPreferences?.retroAchievementsWebApiKey);

  const updateGame = useCallback(async () => {
    if (!IS_DESKTOP) return;
    const result = await globalThis.window.electron.getGameByObjectId(
      shop,
      objectId
    );
    setGame(result);
  }, [objectId, shop]);

  const matchedSteamObjectId =
    shop === "custom" ? (game?.matchedSteamObjectId ?? null) : null;
  const effectiveShop: GameShop = matchedSteamObjectId ? "steam" : shop;
  const effectiveObjectId = matchedSteamObjectId ?? objectId;

  // The effective identity starts as the raw custom shop/objectId (before
  // `game` has loaded) and can change to the matched Steam identity once it
  // does, re-running this callback's owning effect with a second, competing
  // in-flight fetch. Track which identity each fetch was actually *for* so
  // a slower, superseded fetch (e.g. the initial "custom" one, which always
  // resolves shopDetails to null) can't clobber a newer one's real result.
  const latestFetchIdentityRef = useRef<string | null>(null);

  const fetchGameDetails = useCallback(
    async ({
      showLoadingState = false,
    }: { showLoadingState?: boolean } = {}) => {
      if (!IS_DESKTOP) return;

      const fetchIdentity = `${effectiveShop}:${effectiveObjectId}`;
      latestFetchIdentityRef.current = fetchIdentity;

      if (showLoadingState) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const shopDetailsPromise =
          effectiveShop === "custom"
            ? Promise.resolve(null)
            : globalThis.window.electron
                .getGameShopDetails(effectiveObjectId, effectiveShop, language)
                .catch(() => null);

        const [statsResult, assets, shopDetailsResult] = await Promise.all([
          effectiveShop === "custom"
            ? Promise.resolve(null)
            : globalThis.window.electron.getGameStats(
                effectiveObjectId,
                effectiveShop
              ),
          globalThis.window.electron.getGameAssets(objectId, shop),
          shopDetailsPromise,
        ]);

        if (latestFetchIdentityRef.current !== fetchIdentity) return;

        if (shopDetailsResult) {
          shopDetailsResult.assets = assets ?? shopDetailsResult.assets;
        }

        setShopDetails(shopDetailsResult);
        setStats(statsResult);
      } finally {
        if (latestFetchIdentityRef.current === fetchIdentity) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [effectiveObjectId, effectiveShop, language, objectId, shop]
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

    if (IS_DESKTOP && effectiveShop !== "custom") {
      globalThis.window.electron.hydraApi
        .get<HowLongToBeatCategory[] | null>(
          `/games/${effectiveShop}/${effectiveObjectId}/how-long-to-beat`,
          { needsAuth: false }
        )
        .then(setHowLongToBeat)
        .catch(() => setHowLongToBeat(null));

      globalThis.window.electron.hydraApi
        .get<ProtonDBData | null>(
          `/games/${effectiveShop}/${effectiveObjectId}/protondb`,
          {
            needsAuth: false,
          }
        )
        .then(setProtonDBData)
        .catch(() => setProtonDBData(null));
    } else {
      setHowLongToBeat(null);
      setProtonDBData(null);
    }
  }, [effectiveObjectId, effectiveShop, refreshGameDetails]);

  useEffect(() => {
    if (!IS_DESKTOP || effectiveShop === "custom") {
      setAchievements([]);
      return;
    }

    let isCurrentRequest = true;

    const request = shouldUseRetroAchievements
      ? globalThis.window.electron.getRetroAchievementsAchievements(
          effectiveObjectId,
          effectiveShop
        )
      : globalThis.window.electron.getUnlockedAchievements(
          effectiveObjectId,
          effectiveShop
        );

    request
      .then((result) => {
        if (!isCurrentRequest) return;
        setAchievements(result ?? []);
      })
      .catch(() => {
        if (!isCurrentRequest) return;
        setAchievements([]);
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [effectiveObjectId, effectiveShop, shouldUseRetroAchievements]);

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
    effectiveShop,
    effectiveObjectId,
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
