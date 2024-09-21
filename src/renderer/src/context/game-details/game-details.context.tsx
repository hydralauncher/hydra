import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { setHeaderTitle } from "@renderer/features";
import { getSteamLanguage } from "@renderer/helpers";
import { useAppDispatch, useAppSelector, useDownload } from "@renderer/hooks";

import type {
  Game,
  GameRepack,
  GameShop,
  GameStats,
  ShopDetails,
} from "@types";

import { useTranslation } from "react-i18next";
import { GameDetailsContext } from "./game-details.context.types";
import { SteamContentDescriptor } from "@shared";
import { repacksContext } from "../repacks/repacks.context";

export const gameDetailsContext = createContext<GameDetailsContext>({
  game: null,
  shopDetails: null,
  repacks: [],
  shop: "steam",
  gameTitle: "",
  isGameRunning: false,
  isLoading: false,
  objectID: undefined,
  gameColor: "",
  showRepacksModal: false,
  showGameOptionsModal: false,
  stats: null,
  hasNSFWContentBlocked: false,
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
}

export function GameDetailsContextProvider({
  children,
}: GameDetailsContextProps) {
  const { objectID, shop } = useParams();

  const [shopDetails, setShopDetails] = useState<ShopDetails | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [hasNSFWContentBlocked, setHasNSFWContentBlocked] = useState(false);

  const [stats, setStats] = useState<GameStats | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [gameColor, setGameColor] = useState("");
  const [isGameRunning, setisGameRunning] = useState(false);
  const [showRepacksModal, setShowRepacksModal] = useState(false);
  const [showGameOptionsModal, setShowGameOptionsModal] = useState(false);

  const [repacks, setRepacks] = useState<GameRepack[]>([]);

  const [searchParams] = useSearchParams();

  const gameTitle = searchParams.get("title")!;

  const { searchRepacks, isIndexingRepacks } = useContext(repacksContext);

  useEffect(() => {
    if (!isIndexingRepacks) {
      searchRepacks(gameTitle).then((repacks) => {
        setRepacks(repacks);
      });
    }
  }, [game, gameTitle, isIndexingRepacks, searchRepacks]);

  const { i18n } = useTranslation("game_details");

  const dispatch = useAppDispatch();

  const { lastPacket } = useDownload();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const updateGame = useCallback(async () => {
    return window.electron
      .getGameByObjectID(objectID!)
      .then((result) => setGame(result));
  }, [setGame, objectID]);

  const isGameDownloading = lastPacket?.game.id === game?.id;

  useEffect(() => {
    updateGame();
  }, [updateGame, isGameDownloading, lastPacket?.game.status]);

  useEffect(() => {
    window.electron
      .getGameShopDetails(
        objectID!,
        shop as GameShop,
        getSteamLanguage(i18n.language)
      )
      .then((result) => {
        setShopDetails(result);

        if (
          result?.content_descriptors.ids.includes(
            SteamContentDescriptor.AdultOnlySexualContent
          )
        ) {
          setHasNSFWContentBlocked(true);
        }
      })
      .finally(() => {
        setIsLoading(false);
      });

    window.electron.getGameStats(objectID!, shop as GameShop).then((result) => {
      setStats(result);
    });

    updateGame();
  }, [updateGame, dispatch, gameTitle, objectID, shop, i18n.language]);

  useEffect(() => {
    setShopDetails(null);
    setGame(null);
    setIsLoading(true);
    setisGameRunning(false);
    dispatch(setHeaderTitle(gameTitle));
  }, [objectID, gameTitle, dispatch]);

  useEffect(() => {
    const unsubscribe = window.electron.onGamesRunning((gamesIds) => {
      const updatedIsGameRunning =
        !!game?.id &&
        !!gamesIds.find((gameRunning) => gameRunning.id == game.id);

      if (isGameRunning != updatedIsGameRunning) {
        updateGame();
      }

      setisGameRunning(updatedIsGameRunning);
    });
    return () => {
      unsubscribe();
    };
  }, [game?.id, isGameRunning, updateGame]);

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
        shop: shop as GameShop,
        repacks,
        gameTitle,
        isGameRunning,
        isLoading,
        objectID,
        gameColor,
        showGameOptionsModal,
        showRepacksModal,
        stats,
        hasNSFWContentBlocked,
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
