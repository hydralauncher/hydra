import { createContext, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { setHeaderTitle } from "@renderer/features";
import { getSteamLanguage } from "@renderer/helpers";
import { useAppDispatch, useAppSelector, useDownload } from "@renderer/hooks";

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
import { GameOptionsModal } from "./modals/game-options-modal";

export interface GameDetailsContext {
  game: Game | null;
  shopDetails: ShopDetails | null;
  repacks: GameRepack[];
  shop: GameShop;
  gameTitle: string;
  isGameRunning: boolean;
  isLoading: boolean;
  objectID: string | undefined;
  gameColor: string;
  setGameColor: React.Dispatch<React.SetStateAction<string>>;
  openRepacksModal: () => void;
  openGameOptionsModal: () => void;
  selectGameExecutable: () => Promise<string | null>;
  updateGame: () => Promise<void>;
}

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
  setGameColor: () => {},
  openRepacksModal: () => {},
  openGameOptionsModal: () => {},
  selectGameExecutable: async () => null,
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
  const [showGameOptionsModal, setShowGameOptionsModal] = useState(false);

  const [searchParams] = useSearchParams();

  const gameTitle = searchParams.get("title")!;

  const { i18n } = useTranslation("game_details");

  const dispatch = useAppDispatch();

  const { startDownload, lastPacket } = useDownload();

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
    Promise.allSettled([
      window.electron.getGameShopDetails(
        objectID!,
        shop as GameShop,
        getSteamLanguage(i18n.language)
      ),
      window.electron.searchGameRepacks(gameTitle),
    ])
      .then(([appDetailsResult, repacksResult]) => {
        if (appDetailsResult.status === "fulfilled")
          setGameDetails(appDetailsResult.value);

        if (repacksResult.status === "fulfilled")
          setRepacks(repacksResult.value);
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
    setShowGameOptionsModal(false);

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
            extensions: ["exe"],
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

  const openRepacksModal = () => setShowRepacksModal(true);
  const openGameOptionsModal = () => setShowGameOptionsModal(true);

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
        setGameColor,
        openRepacksModal,
        openGameOptionsModal,
        selectGameExecutable,
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

        {game && (
          <GameOptionsModal
            visible={showGameOptionsModal}
            game={game}
            onClose={() => {
              setShowGameOptionsModal(false);
            }}
          />
        )}

        {children}
      </>
    </Provider>
  );
}
