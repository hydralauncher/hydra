import { createContext, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { setHeaderTitle } from "@renderer/features";
import { getSteamLanguage } from "@renderer/helpers";
import { useAppDispatch, useDownload } from "@renderer/hooks";

import type { Game, GameRepack, GameShop, ShopDetails } from "@types";

import { useTranslation } from "react-i18next";
import {
  DODIInstallationGuide,
  DONT_SHOW_DODI_INSTRUCTIONS_KEY,
  DONT_SHOW_ONLINE_FIX_INSTRUCTIONS_KEY,
  OnlineFixInstallationGuide,
  RepacksModal,
} from "./modals";
import { Downloader } from "@shared";

export interface GameDetailsContext {
  game: Game | null;
  shopDetails: ShopDetails | null;
  repacks: GameRepack[];
  gameTitle: string;
  isGameRunning: boolean;
  isLoading: boolean;
  objectID: string | undefined;
  gameColor: string;
  setGameColor: React.Dispatch<React.SetStateAction<string>>;
  openRepacksModal: () => void;
  updateGame: () => Promise<void>;
}

export const gameDetailsContext = createContext<GameDetailsContext>({
  game: null,
  shopDetails: null,
  repacks: [],
  gameTitle: "",
  isGameRunning: false,
  isLoading: false,
  objectID: undefined,
  gameColor: "",
  setGameColor: () => {},
  openRepacksModal: () => {},
  updateGame: async () => {},
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

  const [shopDetails, setGameDetails] = useState<ShopDetails | null>(null);
  const [repacks, setRepacks] = useState<GameRepack[]>([]);
  const [game, setGame] = useState<Game | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [gameColor, setGameColor] = useState("");
  const [showInstructionsModal, setShowInstructionsModal] = useState<
    null | "onlinefix" | "DODI"
  >(null);
  const [isGameRunning, setisGameRunning] = useState(false);
  const [showRepacksModal, setShowRepacksModal] = useState(false);

  const [searchParams] = useSearchParams();

  const gameTitle = searchParams.get("title")!;

  const { i18n } = useTranslation("game_details");

  const dispatch = useAppDispatch();

  const { startDownload, lastPacket } = useDownload();

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
    Promise.all([
      window.electron.getGameShopDetails(
        objectID!,
        shop as GameShop,
        getSteamLanguage(i18n.language)
      ),
      window.electron.searchGameRepacks(gameTitle),
    ])
      .then(([appDetails, repacks]) => {
        if (appDetails) setGameDetails(appDetails);
        setRepacks(repacks);
      })
      .finally(() => {
        setIsLoading(false);
      });

    updateGame();
  }, [updateGame, dispatch, gameTitle, objectID, shop, i18n.language]);

  useEffect(() => {
    setGameDetails(null);
    setGame(null);
    setIsLoading(true);
    setisGameRunning(false);
    dispatch(setHeaderTitle(gameTitle));
  }, [objectID, gameTitle, dispatch]);

  useEffect(() => {
    const listeners = [
      window.electron.onGameClose(() => {
        if (isGameRunning) setisGameRunning(false);
      }),
      window.electron.onPlaytime((gameId) => {
        if (gameId === game?.id) {
          if (!isGameRunning) setisGameRunning(true);
          updateGame();
        }
      }),
    ];

    return () => {
      listeners.forEach((unsubscribe) => unsubscribe());
    };
  }, [game?.id, isGameRunning, updateGame]);

  const handleStartDownload = async (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string
  ) => {
    await startDownload({
      repackId: repack.id,
      objectID: objectID!,
      title: gameTitle,
      downloader,
      shop: shop as GameShop,
      downloadPath,
    });

    await updateGame();
    setShowRepacksModal(false);

    if (
      repack.repacker === "onlinefix" &&
      !window.localStorage.getItem(DONT_SHOW_ONLINE_FIX_INSTRUCTIONS_KEY)
    ) {
      setShowInstructionsModal("onlinefix");
    } else if (
      repack.repacker === "DODI" &&
      !window.localStorage.getItem(DONT_SHOW_DODI_INSTRUCTIONS_KEY)
    ) {
      setShowInstructionsModal("DODI");
    }
  };

  const openRepacksModal = () => setShowRepacksModal(true);

  return (
    <Provider
      value={{
        game,
        shopDetails,
        repacks,
        gameTitle,
        isGameRunning,
        isLoading,
        objectID,
        gameColor,
        setGameColor,
        openRepacksModal,
        updateGame,
      }}
    >
      <>
        <RepacksModal
          visible={showRepacksModal}
          startDownload={handleStartDownload}
          onClose={() => setShowRepacksModal(false)}
        />

        <OnlineFixInstallationGuide
          visible={showInstructionsModal === "onlinefix"}
          onClose={() => setShowInstructionsModal(null)}
        />

        <DODIInstallationGuide
          visible={showInstructionsModal === "DODI"}
          onClose={() => setShowInstructionsModal(null)}
        />

        {children}
      </>
    </Provider>
  );
}
