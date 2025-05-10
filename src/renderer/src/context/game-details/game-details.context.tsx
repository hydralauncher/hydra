import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { setHeaderTitle } from "@renderer/features";
import { getSteamLanguage } from "@renderer/helpers";
import {
  useAppDispatch,
  useAppSelector,
  useDownload,
  useRepacks,
  useUserDetails,
} from "@renderer/hooks";

import type {
  GameShop,
  GameStats,
  LibraryGame,
  ShopDetailsWithAssets,
  UserAchievement,
} from "@types";

import { useTranslation } from "react-i18next";
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
  gameColor: "",
  showRepacksModal: false,
  showGameOptionsModal: false,
  stats: null,
  achievements: null,
  hasNSFWContentBlocked: false,
  lastDownloadedOption: null,
  setGameColor: () => {},
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
  const [gameColor, setGameColor] = useState("");
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [showRepacksModal, setShowRepacksModal] = useState(false);
  const [showGameOptionsModal, setShowGameOptionsModal] = useState(false);

  const { getRepacksForObjectId } = useRepacks();

  const repacks = useMemo(() => {
    return getRepacksForObjectId(objectId);
  }, [getRepacksForObjectId, objectId]);

  const { i18n } = useTranslation("game_details");

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
  }, [setGame, shop, objectId]);

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

    const statsPromise = window.electron
      .getGameStats(objectId, shop)
      .then((result) => {
        if (abortController.signal.aborted) return null;
        setStats(result);
        return result;
      });

    Promise.all([shopDetailsPromise, statsPromise])
      .then(([_, stats]) => {
        if (stats) {
          const assets = stats.assets;
          if (assets) {
            window.electron.saveGameShopAssets(objectId, shop, assets);

            setShopDetails((prev) => {
              if (!prev) return null;
              console.log("assets", assets);
              return {
                ...prev,
                assets,
              };
            });
          }
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
        .catch(() => {});
    }

    updateGame();
  }, [
    updateGame,
    dispatch,
    gameTitle,
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

  const lastDownloadedOption = useMemo(() => {
    if (game?.download) {
      const repack = repacks.find((repack) =>
        repack.uris.some((uri) => uri.includes(game.download!.uri))
      );

      if (!repack) return null;
      return repack;
    }

    return null;
  }, [game?.download, repacks]);

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
        gameColor,
        showGameOptionsModal,
        showRepacksModal,
        stats,
        achievements,
        hasNSFWContentBlocked,
        lastDownloadedOption,
        setHasNSFWContentBlocked,
        setGameColor,
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
