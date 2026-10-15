import { createContext, useCallback, useEffect, useRef, useState } from "react";

import { setHeaderTitle } from "@renderer/features";
import { levelDBService } from "@renderer/services/leveldb.service";
import { ensureArray } from "@renderer/helpers";
import { orderBy } from "lodash-es";
import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useLibraryGamePresentation,
  useUserDetails,
} from "@renderer/hooks";

import type {
  DownloadSource,
  GameRepack,
  GameShop,
  GameStats,
  LibraryGame,
  ShopDetailsWithAssets,
  UserAchievement,
} from "@types";

import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import {
  GameDetailsContext,
  GameOptionsCategoryId,
} from "./game-details.context.types";
import {
  applyHosterAvailability,
  fetchHosterAvailability,
  filterDownloadableRepacks,
  getGameExecutableFilters,
  SteamContentDescriptor,
} from "@shared";

export const gameDetailsContext = createContext<GameDetailsContext>({
  game: null,
  downloadGame: null,
  presentation: null,
  catalogueGame: { shop: "steam", objectId: "" },
  shopDetails: null,
  repacks: [],
  shop: "steam",
  gameTitle: "",
  isGameRunning: false,
  isLoading: false,
  objectId: undefined,
  showRepacksModal: false,
  showGameOptionsModal: false,
  gameOptionsInitialCategory: "general",
  stats: null,
  achievements: null,
  hasNSFWContentBlocked: false,
  lastDownloadedOption: null,
  isTransferring: false,
  transferProgress: 0,
  selectGameExecutable: async () => null,
  updateGame: async () => {},
  refreshGameDetails: async () => {},
  setShowGameOptionsModal: () => {},
  setGameOptionsInitialCategory: () => {},
  setShowRepacksModal: () => {},
  setHasNSFWContentBlocked: () => {},
  cancelTransfer: () => {},
});

const { Provider } = gameDetailsContext;
export const { Consumer: GameDetailsContextConsumer } = gameDetailsContext;

export interface GameDetailsContextProps {
  children: React.ReactNode;
  objectId: string;
  gameTitle: string;
  shop: GameShop;
  syncHeaderTitle?: boolean;
  lockAchievementIdentity?: boolean;
}

export function GameDetailsContextProvider({
  children,
  objectId,
  gameTitle,
  shop,
  syncHeaderTitle = true,
  lockAchievementIdentity = false,
}: Readonly<GameDetailsContextProps>) {
  const [shopDetails, setShopDetails] = useState<ShopDetailsWithAssets | null>(
    null
  );
  const [achievements, setAchievements] = useState<UserAchievement[] | null>(
    null
  );
  const [game, setGame] = useState<LibraryGame | null>(null);
  const [hasNSFWContentBlocked, setHasNSFWContentBlocked] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const achievementUpdateCountRef = useRef(0);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferProgress, setTransferProgress] = useState(0);

  const [stats, setStats] = useState<GameStats | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [showRepacksModal, setShowRepacksModal] = useState(false);
  const [showGameOptionsModal, setShowGameOptionsModal] = useState(false);
  const [gameOptionsInitialCategory, setGameOptionsInitialCategory] =
    useState<GameOptionsCategoryId>("general");
  const [repacks, setRepacks] = useState<GameRepack[]>([]);

  const { t, i18n } = useTranslation("game_details");
  const location = useLocation();

  const dispatch = useAppDispatch();

  const { lastPacket } = useDownload();
  const { userDetails } = useUserDetails();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const presentation = useLibraryGamePresentation({ shop, objectId }, game);
  const downloadGame = presentation?.downloadGame ?? game;
  const operationalShop = presentation?.operationalGame.shop ?? shop;
  const operationalObjectId =
    presentation?.operationalGame.objectId ?? objectId;
  const catalogueShop =
    presentation?.catalogueGame.shop ?? game?.catalogueGame?.shop ?? shop;
  const catalogueObjectId =
    presentation?.catalogueGame.objectId ??
    game?.catalogueGame?.objectId ??
    objectId;
  const gameRequestId = useRef(0);
  const achievementShop = lockAchievementIdentity
    ? shop
    : (presentation?.achievementGame?.shop ?? operationalShop);
  const achievementObjectId = lockAchievementIdentity
    ? objectId
    : (presentation?.achievementGame?.objectId ?? operationalObjectId);
  const pageSyncKey = useRef("");

  useEffect(() => {
    const members = presentation?.members ?? (game ? [game] : []);
    const eligible = members.filter(
      (member) =>
        member.shop === "steam" ||
        (member.shop === "epic" && member.hasActiveEpicImport)
    );
    const key = JSON.stringify([
      userDetails?.id,
      shop,
      objectId,
      eligible.map((member) => `${member.shop}:${member.objectId}`).sort(),
    ]);
    if (pageSyncKey.current === key) return;
    pageSyncKey.current = key;
    for (const member of eligible) {
      if (member.shop === "epic")
        void window.electron
          .syncEpicGameOnGamePage?.(member.objectId)
          .catch(() => {});
      else
        void window.electron
          .syncSteamGameOnGamePage?.(member.objectId)
          .catch(() => {});
    }
  }, [presentation, game, shop, objectId, userDetails?.id]);

  const updateGame = useCallback(async () => {
    const requestId = ++gameRequestId.current;
    return window.electron
      .getGameByObjectId(operationalShop, operationalObjectId)
      .then((result) => {
        if (requestId === gameRequestId.current) setGame(result);
      });
  }, [operationalShop, operationalObjectId]);

  const fetchGameDetails = useCallback(async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const shopDetailsPromise = window.electron
      .getGameShopDetails(catalogueObjectId, catalogueShop, i18n.language, {
        artworkIdentity: {
          shop: operationalShop,
          objectId: operationalObjectId,
        },
      })
      .then((result) => {
        if (abortController.signal.aborted) return;

        setShopDetails(result);

        if (
          result?.content_descriptors.ids.includes(
            SteamContentDescriptor.AdultOnlySexualContent
          ) &&
          !userPreferences?.disableNsfwAlert
        ) {
          setHasNSFWContentBlocked(true);
        }

        if (result?.assets) {
          setIsLoading(false);
        }

        if (userDetails && shop !== "custom") {
          const achievementUpdateCount = achievementUpdateCountRef.current;
          const isStaleAchievementResult = () =>
            abortController.signal.aborted ||
            achievementUpdateCount !== achievementUpdateCountRef.current;
          const useRetroAchievements =
            shop === "launchbox" &&
            Boolean(userPreferences?.retroAchievementsWebApiKey);

          if (useRetroAchievements) {
            globalThis.window.electron
              .getRetroAchievementsAchievements(
                objectId,
                shop,
                result?.retroAchievementsGameId ?? undefined
              )
              .then((achievements) => {
                if (isStaleAchievementResult()) return;
                setAchievements(achievements ?? []);
              })
              .catch(() => {
                if (!isStaleAchievementResult()) setAchievements([]);
              });
          } else {
            globalThis.window.electron
              .getUnlockedAchievements(achievementObjectId, achievementShop)
              .then((achievements) => {
                if (isStaleAchievementResult()) return;
                if (achievements) setAchievements(achievements);
              })
              .catch(() => void 0);
          }
        }
      });

    if (shop !== "custom") {
      void window.electron
        .getGameStats(catalogueObjectId, catalogueShop)
        .then((result) => {
          if (abortController.signal.aborted) return;
          setStats(result);
        })
        .catch(() => {
          if (abortController.signal.aborted) return;
          setStats(null);
        });
    }

    const assetsPromise = window.electron.getGameAssets(
      catalogueObjectId,
      catalogueShop,
      {
        artworkIdentity: {
          shop: operationalShop,
          objectId: operationalObjectId,
        },
      }
    );

    Promise.all([shopDetailsPromise, assetsPromise])
      .then(([_, assets]) => {
        if (assets) {
          if (abortController.signal.aborted) return;
          setShopDetails((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              assets,
            };
          });
        }
      })
      .finally(() => {
        if (abortController.signal.aborted) return;
        setIsLoading(false);
      });
  }, [
    i18n.language,
    objectId,
    shop,
    catalogueShop,
    catalogueObjectId,
    operationalShop,
    operationalObjectId,
    achievementShop,
    achievementObjectId,
    userDetails,
    userPreferences?.disableNsfwAlert,
    userPreferences?.retroAchievementsWebApiKey,
  ]);

  const refreshGameDetails = useCallback(async () => {
    await Promise.all([updateGame(), fetchGameDetails()]);
  }, [fetchGameDetails, updateGame]);

  const isGameDownloading =
    lastPacket?.gameId === downloadGame?.id &&
    downloadGame?.download?.status === "active";

  useEffect(() => {
    if (isGameDownloading || (game?.id && lastPacket?.gameId === game.id)) {
      updateGame();
    }
  }, [updateGame, isGameDownloading, game?.id, lastPacket?.gameId]);

  // Listen for transfer events
  useEffect(() => {
    const onTransferProgress = (
      _: unknown,
      shop: string,
      objectId: string,
      progress: number
    ) => {
      if (shop === game?.shop && objectId === game?.objectId) {
        setIsTransferring(progress >= 0 && progress < 1);
        setTransferProgress(progress);
      }
    };

    const onTransferComplete = (_: unknown, shop: string, objectId: string) => {
      if (shop === game?.shop && objectId === game?.objectId) {
        setIsTransferring(false);
        setTransferProgress(0);
        updateGame();
      }
    };

    const onTransferCancelled = (
      _: unknown,
      shop: string,
      objectId: string
    ) => {
      if (shop === game?.shop && objectId === game?.objectId) {
        setIsTransferring(false);
        setTransferProgress(0);
      }
    };

    const onTransferError = (_: unknown, shop: string, objectId: string) => {
      if (shop === game?.shop && objectId === game?.objectId) {
        setIsTransferring(false);
        setTransferProgress(0);
      }
    };

    window.electron.on("on-game-transfer-progress", onTransferProgress);
    window.electron.on("on-game-transfer-complete", onTransferComplete);
    window.electron.on("on-game-transfer-cancelled", onTransferCancelled);
    window.electron.on("on-game-transfer-error", onTransferError);

    return () => {
      window.electron.off("on-game-transfer-progress", onTransferProgress);
      window.electron.off("on-game-transfer-complete", onTransferComplete);
      window.electron.off("on-game-transfer-cancelled", onTransferCancelled);
      window.electron.off("on-game-transfer-error", onTransferError);
    };
  }, [game]);

  useEffect(() => {
    gameRequestId.current += 1;
    setShopDetails(null);
    setGame(null);
    setIsLoading(true);
    setIsGameRunning(false);
    setAchievements(null);
    setGameOptionsInitialCategory("general");
    if (syncHeaderTitle) dispatch(setHeaderTitle(gameTitle));
    refreshGameDetails().catch(() => {});
  }, [
    objectId,
    shop,
    gameTitle,
    syncHeaderTitle,
    dispatch,
    refreshGameDetails,
  ]);

  useEffect(() => {
    const state =
      (location && (location.state as Record<string, unknown>)) || {};
    if (state.openRepacks) {
      setShowRepacksModal(true);
      try {
        window.history.replaceState({}, document.title, location.pathname);
      } catch (e) {
        console.error(e);
      }
    }
  }, [location]);

  useEffect(() => {
    const title = presentation?.title ?? game?.title;
    if (syncHeaderTitle && title) {
      dispatch(setHeaderTitle(title));
    }
  }, [presentation?.title, game?.title, syncHeaderTitle, dispatch]);

  useEffect(() => {
    const unsubscribe = window.electron.onGamesRunning((gamesIds) => {
      const updatedIsGameRunning =
        !!game?.id &&
        !!gamesIds.find((gameRunning) => gameRunning.id == game.id);

      if (isGameRunning != updatedIsGameRunning) {
        updateGame();
      }

      setIsGameRunning(updatedIsGameRunning);
    });

    return () => {
      unsubscribe();
    };
  }, [game?.id, isGameRunning, updateGame]);

  useEffect(() => {
    const unsubscribe = window.electron.onLibraryBatchComplete(() => {
      refreshGameDetails().catch(() => {});
    });

    return () => {
      unsubscribe();
    };
  }, [refreshGameDetails]);

  useEffect(() => {
    const handler = (ev: Event) => {
      try {
        const detail = (ev as CustomEvent).detail || {};
        if (
          detail.objectId &&
          (detail.objectId === objectId ||
            (detail.objectId === operationalObjectId &&
              (!detail.shop || detail.shop === operationalShop)))
        ) {
          setShowRepacksModal(true);
        }
      } catch (e) {
        void e;
      }
    };

    window.addEventListener("hydra:openRepacks", handler as EventListener);

    return () => {
      window.removeEventListener("hydra:openRepacks", handler as EventListener);
    };
  }, [objectId, operationalObjectId, operationalShop]);

  useEffect(() => {
    const handler = (ev: Event) => {
      try {
        const detail = (ev as CustomEvent).detail || {};
        if (
          detail.objectId &&
          (detail.objectId === objectId ||
            (detail.objectId === operationalObjectId &&
              (!detail.shop || detail.shop === operationalShop)))
        ) {
          setGameOptionsInitialCategory("general");
          setShowGameOptionsModal(true);
        }
      } catch (e) {
        void e;
      }
    };

    window.addEventListener("hydra:openGameOptions", handler as EventListener);

    return () => {
      window.removeEventListener(
        "hydra:openGameOptions",
        handler as EventListener
      );
    };
  }, [objectId, operationalObjectId, operationalShop]);

  useEffect(() => {
    const state =
      (location && (location.state as Record<string, unknown>)) || {};
    if (state.openGameOptions) {
      setGameOptionsInitialCategory("general");
      setShowGameOptionsModal(true);

      try {
        window.history.replaceState({}, document.title, location.pathname);
      } catch (_e) {
        void _e;
      }
    }
  }, [location]);

  useEffect(() => {
    const members =
      presentation?.availableShops.includes("steam") &&
      presentation.availableShops.includes("epic")
        ? presentation.members.filter(
            (member) => member.shop === "steam" || member.shop === "epic"
          )
        : [{ objectId: achievementObjectId, shop: achievementShop }];
    const unsubscribe = members.map((member) =>
      window.electron.onUpdateAchievements(
        member.objectId,
        member.shop,
        (achievements) => {
          if (!userDetails) return;
          if (
            (member.objectId !== achievementObjectId ||
              member.shop !== achievementShop) &&
            !achievements.some(
              (achievement) => achievement.canonicalAchievementId
            )
          )
            return;
          achievementUpdateCountRef.current += 1;
          setAchievements(achievements);
        }
      )
    );

    return () => {
      unsubscribe.forEach((stop) => stop());
    };
  }, [achievementObjectId, achievementShop, userDetails, presentation]);

  useEffect(() => {
    if (shop === "custom") return;

    let cancelled = false;

    const fetchDownloadSources = async () => {
      try {
        const sourcesRaw = (await levelDBService.values(
          "downloadSources"
        )) as DownloadSource[];
        const sources = orderBy(sourcesRaw, "createdAt", "desc");

        const params = {
          take: 100,
          skip: 0,
          downloadSourceIds: sources.map((source) => source.id),
        };

        const downloads = await window.electron.hydraApi.get<GameRepack[]>(
          `/games/${catalogueShop}/${catalogueObjectId}/download-sources`,
          {
            params,
            needsAuth: false,
          }
        );

        if (cancelled) return;

        const downloadOptions = filterDownloadableRepacks(
          ensureArray<GameRepack>(
            downloads,
            `/games/${catalogueShop}/${catalogueObjectId}/download-sources`
          )
        );

        setRepacks(downloadOptions);

        const results = await fetchHosterAvailability(
          downloadOptions,
          (url, data) =>
            window.electron.hydraApi.post(url, { data, needsAuth: false })
        );

        if (cancelled || results.length === 0) return;

        setRepacks(applyHosterAvailability(downloadOptions, results));
      } catch (error) {
        console.error("Failed to fetch download sources:", error);
      }
    };

    fetchDownloadSources();

    return () => {
      cancelled = true;
    };
  }, [shop, catalogueShop, catalogueObjectId]);

  const getDownloadsPath = async () => {
    if (userPreferences?.downloadsPath) return userPreferences.downloadsPath;
    return window.electron.getDefaultDownloadsPath();
  };

  const selectGameExecutable = async () => {
    const downloadsPath = await getDownloadsPath();

    const filters = getGameExecutableFilters(
      globalThis.window.electron.platform,
      {
        executable: t("game_executable"),
        allFiles: t("all_files"),
      }
    );

    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      defaultPath: downloadsPath,
      filters,
    });

    return filePaths?.[0] ?? null;
  };

  // Handlers for cancel
  const cancelTransfer = () => {
    void window.electron
      .cancelGameTransfer?.(operationalShop, operationalObjectId)
      .catch((error) => {
        console.error("Failed to cancel game transfer:", error);
      });
    setIsTransferring(false);
    setTransferProgress(0);
  };

  return (
    <Provider
      value={{
        game,
        downloadGame,
        presentation: presentation ?? null,
        catalogueGame: { shop: catalogueShop, objectId: catalogueObjectId },
        shopDetails,
        shop: lockAchievementIdentity ? achievementShop : operationalShop,
        repacks,
        gameTitle: presentation?.title ?? shopDetails?.name ?? gameTitle,
        isGameRunning,
        isLoading,
        objectId: lockAchievementIdentity
          ? achievementObjectId
          : operationalObjectId,
        showGameOptionsModal,
        gameOptionsInitialCategory,
        showRepacksModal,
        stats,
        achievements,
        hasNSFWContentBlocked,
        lastDownloadedOption: null,
        isTransferring,
        transferProgress,
        setHasNSFWContentBlocked,
        selectGameExecutable,
        updateGame,
        refreshGameDetails,
        setShowRepacksModal,
        setShowGameOptionsModal,
        setGameOptionsInitialCategory,
        cancelTransfer,
      }}
    >
      {children}
    </Provider>
  );
}
