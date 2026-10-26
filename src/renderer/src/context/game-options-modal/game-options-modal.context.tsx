import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import type { GameRepack, GameShop, LibraryGame } from "@types";
import { Downloader, getDownloadersForUri } from "@shared";
import { useDownload } from "@renderer/hooks";
import {
  GameOptionsModal,
  RepacksModal,
} from "@renderer/pages/game-details/modals";
import { CloudSaveV2Provider } from "@renderer/pages/game-details/cloud-save-v2";
import type { GameSettingsCategoryId } from "@renderer/pages/game-details/modals/game-options-modal/types";

import { CloudSyncContextProvider } from "../cloud-sync/cloud-sync.context";
import {
  gameDetailsContext,
  GameDetailsContextProvider,
} from "../game-details/game-details.context";

export interface DownloadOptionsTarget {
  objectId: string;
  shop: GameShop;
  title: string;
}

export interface GameOptionsModalContext {
  openGameOptionsModal: (
    game: LibraryGame,
    initialCategory?: GameSettingsCategoryId
  ) => void;
  openDownloadOptionsModal: (game: DownloadOptionsTarget) => void;
}

export const gameOptionsModalContext = createContext<GameOptionsModalContext>({
  openGameOptionsModal: () => {},
  openDownloadOptionsModal: () => {},
});

const { Provider } = gameOptionsModalContext;

export const useGameOptionsModal = () => useContext(gameOptionsModalContext);

export interface GameOptionsModalProviderProps {
  children: React.ReactNode;
}

interface GameOptionsModalTarget {
  game: LibraryGame;
  initialCategory: GameSettingsCategoryId;
}

interface GameOptionsModalHostProps {
  target: GameOptionsModalTarget;
  onClose: () => void;
  onNavigateHome: () => void;
}

function GameOptionsModalHost({
  target,
  onClose,
  onNavigateHome,
}: Readonly<GameOptionsModalHostProps>) {
  const { game } = useContext(gameDetailsContext);

  if (!game) return null;

  return (
    <GameOptionsModal
      visible
      game={game}
      initialCategory={target.initialCategory}
      onClose={onClose}
      onNavigateHome={onNavigateHome}
    />
  );
}

interface DownloadOptionsModalHostProps {
  fallbackObjectId: string;
  onClose: () => void;
}

function DownloadOptionsModalHost({
  fallbackObjectId,
  onClose,
}: Readonly<DownloadOptionsModalHostProps>) {
  const { game, downloadGame, gameTitle, shop, updateGame, hasLoadedRepacks } =
    useContext(gameDetailsContext);
  const { startDownload, addGameToQueue } = useDownload();

  const handleStartDownload = async (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string,
    automaticallyExtract: boolean,
    addToQueueOnly = false,
    fileIndices?: number[],
    selectedFilesSize?: number | null,
    automaticallyDeleteArchiveFiles = false,
    signal?: AbortSignal
  ) => {
    const payload = {
      objectId: downloadGame?.objectId ?? game?.objectId ?? fallbackObjectId,
      title: gameTitle,
      downloader,
      shop: downloadGame?.shop ?? game?.shop ?? shop,
      downloadPath,
      uri: repack.uris.find((uri) =>
        getDownloadersForUri(uri).includes(downloader)
      )!,
      automaticallyExtract,
      automaticallyDeleteArchiveFiles,
      fileSize: repack.fileSize,
      fileIndices,
      selectedFilesSize,
    };

    const response = addToQueueOnly
      ? await addGameToQueue(payload, signal)
      : await startDownload(payload, signal);

    if (response.ok) {
      await updateGame();
      onClose();
    }

    return response;
  };

  return (
    <RepacksModal
      visible={hasLoadedRepacks}
      startDownload={handleStartDownload}
      onClose={onClose}
    />
  );
}

export function GameOptionsModalProvider({
  children,
}: Readonly<GameOptionsModalProviderProps>) {
  const navigate = useNavigate();
  const [target, setTarget] = useState<GameOptionsModalTarget | null>(null);
  const [downloadTarget, setDownloadTarget] =
    useState<DownloadOptionsTarget | null>(null);

  const openDownloadOptionsModal = useCallback(
    (game: DownloadOptionsTarget) => setDownloadTarget(game),
    []
  );

  const closeDownloadOptionsModal = useCallback(
    () => setDownloadTarget(null),
    []
  );

  const openGameOptionsModal = useCallback(
    (game: LibraryGame, initialCategory: GameSettingsCategoryId = "general") =>
      setTarget({ game, initialCategory }),
    []
  );

  const closeGameOptionsModal = useCallback(() => setTarget(null), []);

  const value = useMemo(
    () => ({ openGameOptionsModal, openDownloadOptionsModal }),
    [openGameOptionsModal, openDownloadOptionsModal]
  );

  return (
    <Provider value={value}>
      {children}

      {target && (
        <GameDetailsContextProvider
          objectId={target.game.objectId}
          shop={target.game.shop}
          gameTitle={target.game.title}
          syncHeaderTitle={false}
        >
          <CloudSaveV2Provider
            objectId={target.game.objectId}
            shop={target.game.shop}
          >
            <CloudSyncContextProvider
              objectId={target.game.objectId}
              shop={target.game.shop}
            >
              <GameOptionsModalHost
                target={target}
                onClose={closeGameOptionsModal}
                onNavigateHome={() => {
                  closeGameOptionsModal();
                  navigate("/");
                }}
              />
            </CloudSyncContextProvider>
          </CloudSaveV2Provider>
        </GameDetailsContextProvider>
      )}

      {downloadTarget && (
        <GameDetailsContextProvider
          key={`${downloadTarget.shop}:${downloadTarget.objectId}`}
          objectId={downloadTarget.objectId}
          shop={downloadTarget.shop}
          gameTitle={downloadTarget.title}
          syncHeaderTitle={false}
        >
          <DownloadOptionsModalHost
            fallbackObjectId={downloadTarget.objectId}
            onClose={closeDownloadOptionsModal}
          />
        </GameDetailsContextProvider>
      )}
    </Provider>
  );
}
