import { createContext, useCallback, useEffect, useRef, useState } from "react";

import { setHeaderTitle } from "@renderer/features";
import { getSteamLanguage } from "@renderer/helpers";
import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useUserDetails,
} from "@renderer/hooks";

import type {
  GameRepack,
  GameShop,
  GameStats,
  LibraryGame,
  ShopDetailsWithAssets,
  UserAchievement,
} from "@types";

import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { GameDetailsContext } from "./game-details.context.types";
import { SteamContentDescriptor } from "@shared";

export const gameDetailsContext = createContext<GameDetailsContext>({
  game: null,
  shopDetails: null,
  repacks: [],
  shop: "steam",
  gameTitle: "",
  isGameRunning: false,
  isLoading: false,
  objectId: undefined,
  showRepacksModal: false,
  showGameOptionsModal: false,
  stats: null,
  achievements: null,
  hasNSFWContentBlocked: false,
  lastDownloadedOption: null,
  selectGameExecutable: async () => null,
  updateGame: async () => {},
  setShowGameOptionsModal: () => {},
  setShowRepacksModal: () => {},
  setHasNSFWContentBlocked: () => {},
});

const { Provider } = gameDetailsContext;
export const { Consumer: GameDetailsContextConsumer } = gameDetailsContext;

export interface GameDetailsContextProps {
  children: React.ReactNode;
  objectId: string;
  gameTitle: string;
  shop: GameShop;
}

export function GameDetailsContextProvider({
  children,
  objectId,
  gameTitle,
  shop,
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

  const [stats, setStats] = useState<GameStats | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [showRepacksModal, setShowRepacksModal] = useState(false);
  const [showGameOptionsModal, setShowGameOptionsModal] = useState(false);
  const [repacks, setRepacks] = useState<GameRepack[]>([]);

  const { i18n } = useTranslation("game_details");
  const location = useLocation();

  const dispatch = useAppDispatch();

  const { lastPacket } = useDownload();
  const { userDetails } = useUserDetails();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const updateGame = useCallback(async () => {
    return window.electron
      .getGameByObjectId(shop, objectId)
      .then((result) => setGame(result));
  }, [shop, objectId]);

  const isGameDownloading =
    lastPacket?.gameId === game?.id && game?.download?.status === "active";

  useEffect(() => {
    updateGame();
  }, [updateGame, isGameDownloading, lastPacket?.gameId]);

  useEffect(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const shopDetailsPromise = window.electron
      .getGameShopDetails(objectId, shop, getSteamLanguage(i18n.language))
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
      });

    window.electron.getGameStats(objectId, shop).then((result) => {
      if (abortController.signal.aborted) return;
      setStats(result);
    });

    const assetsPromise = window.electron.getGameAssets(objectId, shop);

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

    if (userDetails) {
      window.electron
        .getUnlockedAchievements(objectId, shop)
        .then((achievements) => {
          if (abortController.signal.aborted) return;
          setAchievements(achievements);
        })
        .catch(() => void 0);
    }
  }, [
    updateGame,
    dispatch,
    objectId,
    shop,
    i18n.language,
    userDetails,
    userPreferences,
  ]);

  useEffect(() => {
    setShopDetails(null);
    setGame(null);
    setIsLoading(true);
    setIsGameRunning(false);
    setAchievements(null);
    dispatch(setHeaderTitle(gameTitle));
  }, [objectId, gameTitle, dispatch]);

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
    if (game?.title) {
      dispatch(setHeaderTitle(game.title));
    }
  }, [game?.title, dispatch]);

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
    const handler = (ev: Event) => {
      try {
        const detail = (ev as CustomEvent).detail || {};
        if (detail.objectId && detail.objectId === objectId) {
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
  }, [objectId]);

  useEffect(() => {
    const handler = (ev: Event) => {
      try {
        const detail = (ev as CustomEvent).detail || {};
        if (detail.objectId && detail.objectId === objectId) {
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
  }, [objectId]);

  useEffect(() => {
    const state =
      (location && (location.state as Record<string, unknown>)) || {};
    if (state.openGameOptions) {
      setShowGameOptionsModal(true);

      try {
        window.history.replaceState({}, document.title, location.pathname);
      } catch (_e) {
        void _e;
      }
    }
  }, [location]);

  useEffect(() => {
    const unsubscribe = window.electron.onUpdateAchievements(
      objectId,
      shop,
      (achievements) => {
        if (!userDetails) return;
        setAchievements(achievements);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [objectId, shop, userDetails]);

  useEffect(() => {
    const fetchDownloadSources = async () => {
      try {
        const sources = await window.electron.getDownloadSources();

        const params = {
          take: 100,
          skip: 0,
          downloadSourceIds: sources.map((source) => source.id),
        };

        const downloads = await window.electron.hydraApi.get<GameRepack[]>(
          `/games/${shop}/${objectId}/download-sources`,
          {
            params,
            needsAuth: false,
          }
        );

        setRepacks(downloads);
      } catch (error) {
        console.error("Failed to fetch download sources:", error);
      }
    };

    fetchDownloadSources();
  }, [shop, objectId]);

  const getDownloadsPath = async () => {
    if (userPreferences?.downloadsPath) return userPreferences.downloadsPath;
    return window.electron.getDefaultDownloadsPath();
  };

  const selectGameExecutable = async () => {
    const downloadsPath = await getDownloadsPath();

    return window.electron
      .showOpenDialog({
        properties: ["openFile"],
        defaultPath: downloadsPath,
        filters: [
          {
            name: "Game executable",
            extensions: ["exe", "lnk"],
          },
        ],
      })
      .then(({ filePaths }) => {
        if (filePaths && filePaths.length > 0) {
          return filePaths[0];
        }

        return null;
      });
  };

  return (
    <Provider
      value={{
        game,
        shopDetails,
        shop,
        repacks,
        gameTitle,
        isGameRunning,
        isLoading,
        objectId,
        showGameOptionsModal,
        showRepacksModal,
        stats,
        achievements,
        hasNSFWContentBlocked,
        lastDownloadedOption: null,
        setHasNSFWContentBlocked,
        selectGameExecutable,
        updateGame,
        setShowRepacksModal,
        setShowGameOptionsModal,
      }}
    >
      {children}
    </Provider>
  );
}
