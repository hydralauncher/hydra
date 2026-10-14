import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyLibraryGroupAction, findLibraryGamePresentation } from "@shared";
import { useTranslation } from "react-i18next";
import { IS_DESKTOP } from "../constants";
import type {
  GameShop,
  GameStats,
  HowLongToBeatCategory,
  LibraryGame,
  ProtonDBData,
  ShopAssets,
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
import { useBigPictureRunningGames } from "./use-big-picture-running-games.hook";
import { useLibrary } from "./use-library.hook";
import { useUserPreferences } from "./use-user-preferences.hook";

const buildFallbackShopDetails = (
  objectId: string,
  assets: ShopAssets | null
): ShopDetailsWithAssets => ({
  objectId,
  name: assets?.title ?? "",
  steam_appid: 0,
  detailed_description: "",
  about_the_game: "",
  short_description: "",
  developers: [],
  publishers: [],
  genres: [],
  supported_languages: "",
  screenshots: [],
  pc_requirements: { minimum: "", recommended: "" },
  mac_requirements: { minimum: "", recommended: "" },
  linux_requirements: { minimum: "", recommended: "" },
  release_date: { coming_soon: false, date: "" },
  content_descriptors: { ids: [] },
  assets,
});

export function useGameDetails(
  objectId: string,
  shop: GameShop,
  lockAchievementIdentity = false
) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [shopDetails, setShopDetails] = useState<ShopDetailsWithAssets | null>(
    null
  );
  const [stats, setStats] = useState<GameStats | null>(null);
  const { downloadLibrary, updateLibrary } = useLibrary();
  const runningGames = useBigPictureRunningGames();
  const [routeGame, setRouteGame] = useState<{
    key: string;
    library: LibraryGame[];
    game: LibraryGame | null;
  } | null>(null);
  const routeKey = `${shop}:${objectId}`;
  const routeRequestRef = useRef(0);
  const detailsAbortRef = useRef<AbortController | null>(null);
  const presentationGame = useMemo(
    () =>
      findLibraryGamePresentation(
        downloadLibrary,
        { shop, objectId },
        Object.keys(runningGames)
      ) ?? null,
    [downloadLibrary, objectId, runningGames, shop]
  );
  const freshRouteGame =
    routeGame?.key === routeKey && routeGame.library === downloadLibrary
      ? routeGame.game
      : null;
  const game =
    freshRouteGame && freshRouteGame.id === presentationGame?.operationalGame.id
      ? freshRouteGame
      : (presentationGame?.operationalGame ?? freshRouteGame);
  const downloadGame = presentationGame?.downloadGame ?? game;
  const operationalGameRef = useRef(game);
  const libraryRef = useRef(downloadLibrary);
  const runningGamesRef = useRef(runningGames);
  operationalGameRef.current = game;
  libraryRef.current = downloadLibrary;
  runningGamesRef.current = runningGames;
  const catalogueShop =
    presentationGame?.catalogueGame.shop ?? game?.catalogueGame?.shop ?? shop;
  const catalogueObjectId =
    presentationGame?.catalogueGame.objectId ??
    game?.catalogueGame?.objectId ??
    objectId;
  const artworkShop = game?.shop ?? catalogueShop;
  const artworkObjectId = game?.objectId ?? catalogueObjectId;
  const runningGame = game ? (runningGames[game.id] ?? null) : null;
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
    (game?.shop ?? shop) === "launchbox" &&
    Boolean(userPreferences?.retroAchievementsWebApiKey);

  const updateGame = useCallback(async () => {
    if (!IS_DESKTOP) return;
    const request = routeRequestRef.current;
    let operationalGame = operationalGameRef.current;
    if (!operationalGame) {
      const library = await globalThis.window.electron.getLibrary(true);
      if (request !== routeRequestRef.current) return;
      operationalGame =
        findLibraryGamePresentation(
          library,
          { shop, objectId },
          Object.keys(runningGamesRef.current)
        )?.operationalGame ?? null;
    }
    const result = await globalThis.window.electron.getGameByObjectId(
      operationalGame?.shop ?? shop,
      operationalGame?.objectId ?? objectId
    );
    if (request !== routeRequestRef.current) return;
    setRouteGame({
      key: `${shop}:${objectId}`,
      library: libraryRef.current,
      game: result,
    });
    await updateLibrary();
  }, [objectId, shop, updateLibrary]);

  useEffect(
    () => () => {
      routeRequestRef.current += 1;
      detailsAbortRef.current?.abort();
    },
    [objectId, shop]
  );

  const fetchGameDetails = useCallback(
    async ({
      showLoadingState = false,
    }: { showLoadingState?: boolean } = {}) => {
      if (!IS_DESKTOP) return;
      detailsAbortRef.current?.abort();
      const abort = new AbortController();
      detailsAbortRef.current = abort;

      if (showLoadingState) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const shopDetailsPromise =
          catalogueShop === "custom"
            ? Promise.resolve(null)
            : globalThis.window.electron
                .getGameShopDetails(
                  catalogueObjectId,
                  catalogueShop,
                  language,
                  {
                    artworkIdentity: {
                      shop: artworkShop,
                      objectId: artworkObjectId,
                    },
                  }
                )
                .catch(() => null);

        const [statsResult, assets, shopDetailsResult] = await Promise.all([
          catalogueShop === "custom"
            ? Promise.resolve(null)
            : globalThis.window.electron.getGameStats(
                catalogueObjectId,
                catalogueShop
              ),
          globalThis.window.electron.getGameAssets(
            catalogueObjectId,
            catalogueShop,
            {
              artworkIdentity: {
                shop: artworkShop,
                objectId: artworkObjectId,
              },
            }
          ),
          shopDetailsPromise,
        ]);
        if (abort.signal.aborted) return;

        if (shopDetailsResult) {
          shopDetailsResult.assets = assets ?? shopDetailsResult.assets;
        }

        setShopDetails(
          shopDetailsResult ??
            buildFallbackShopDetails(catalogueObjectId, assets ?? null)
        );
        setStats(statsResult);
      } finally {
        if (!abort.signal.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [catalogueObjectId, catalogueShop, artworkObjectId, artworkShop, language]
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
    let current = true;
    setShopDetails(null);
    setStats(null);
    setHowLongToBeat(null);
    setProtonDBData(null);
    refreshGameDetails({ showLoadingState: true }).catch(() => {});

    if (IS_DESKTOP && catalogueShop !== "custom") {
      globalThis.window.electron.hydraApi
        .get<HowLongToBeatCategory[] | null>(
          `/games/${catalogueShop}/${catalogueObjectId}/how-long-to-beat`,
          { needsAuth: false }
        )
        .then((data) => {
          if (current) setHowLongToBeat(Array.isArray(data) ? data : null);
        })
        .catch(() => {
          if (current) setHowLongToBeat(null);
        });

      globalThis.window.electron.hydraApi
        .get<ProtonDBData | null>(
          `/games/${catalogueShop}/${catalogueObjectId}/protondb`,
          {
            needsAuth: false,
          }
        )
        .then((data) => {
          if (current) setProtonDBData(data);
        })
        .catch(() => {
          if (current) setProtonDBData(null);
        });
    } else {
      setHowLongToBeat(null);
      setProtonDBData(null);
    }
    return () => {
      current = false;
      detailsAbortRef.current?.abort();
    };
  }, [catalogueObjectId, catalogueShop, refreshGameDetails]);

  useEffect(() => {
    const achievementShop = lockAchievementIdentity
      ? shop
      : (game?.shop ?? shop);
    const achievementObjectId = lockAchievementIdentity
      ? objectId
      : (game?.objectId ?? objectId);
    if (!IS_DESKTOP || achievementShop === "custom") {
      setAchievements([]);
      return;
    }

    let isCurrentRequest = true;

    const request = shouldUseRetroAchievements
      ? globalThis.window.electron.getRetroAchievementsAchievements(
          achievementObjectId,
          achievementShop
        )
      : globalThis.window.electron.getUnlockedAchievements(
          achievementObjectId,
          achievementShop
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
  }, [
    game?.objectId,
    game?.shop,
    objectId,
    shop,
    shouldUseRetroAchievements,
    lockAchievementIdentity,
  ]);

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

  const syncTargets = JSON.stringify(
    (presentationGame?.members ?? (game ? [game] : []))
      .filter(
        (member) => member.hasActiveSteamImport || member.hasActiveEpicImport
      )
      .map((member) => ({ shop: member.shop, objectId: member.objectId }))
  );
  useEffect(() => {
    if (!IS_DESKTOP) return;
    let current = true;
    const targets = JSON.parse(syncTargets) as {
      shop: GameShop;
      objectId: string;
    }[];
    void Promise.all(
      targets.map(async (target) => {
        const bridge = globalThis.window.electron;
        if (
          target.shop === "epic" &&
          typeof bridge.syncEpicGameOnGamePage === "function"
        )
          return bridge
            .syncEpicGameOnGamePage(target.objectId)
            .catch(() => false);
        if (
          target.shop === "steam" &&
          typeof bridge.syncSteamGameOnGamePage === "function"
        )
          return bridge
            .syncSteamGameOnGamePage(target.objectId)
            .catch(() => false);
        return false;
      })
    ).then((changed) => {
      if (current && changed.some(Boolean)) void updateGame().catch(() => {});
    });
    return () => {
      current = false;
    };
  }, [syncTargets, updateGame]);

  const toggleFavorite = useCallback(async () => {
    if (!game) return;

    const preferredAssets = resolvePreferredGameAssets(
      presentationGame ?? game,
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
      const wasFavorite = presentationGame?.favorite ?? game.favorite;
      await applyLibraryGroupAction(
        presentationGame?.members ?? [game],
        (member) =>
          wasFavorite
            ? globalThis.window.electron.removeGameFromFavorites(
                member.shop,
                member.objectId
              )
            : globalThis.window.electron.addGameToFavorites(
                member.shop,
                member.objectId
              )
      );

      await refreshGameDetails();
      globalThis.window.dispatchEvent(new Event("library-update"));
      const { title, ...toastOptions } = await buildFavoriteToastOptions(
        toastSource,
        wasFavorite ? "removed" : "added"
      );
      showSuccessToast(title, toastOptions);
    } catch {
      await updateGame().catch(() => {});
      globalThis.window.dispatchEvent(new Event("library-update"));
      const toastOptions = await buildGameToastVisualOptions(toastSource);
      showErrorToast("Failed to update favorites", {
        ...toastOptions,
        message: `${toastSource.title} couldn't be updated right now.`,
      });
    }
  }, [
    game,
    presentationGame,
    shopDetails?.assets,
    showErrorToast,
    showSuccessToast,
    refreshGameDetails,
    updateGame,
  ]);

  const preferredAssets = useMemo(
    () =>
      resolvePreferredGameAssets(presentationGame ?? game, shopDetails?.assets),
    [game, presentationGame, shopDetails?.assets]
  );

  return {
    shopDetails,
    preferredAssets,
    stats,
    game,
    presentationGame,
    catalogueGame: { shop: catalogueShop, objectId: catalogueObjectId },
    downloadGame,
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
