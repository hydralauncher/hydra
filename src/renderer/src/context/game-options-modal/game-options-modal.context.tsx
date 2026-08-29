import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import type { LibraryGame } from "@types";
import { GameOptionsModal } from "@renderer/pages/game-details/modals";
import type { GameSettingsCategoryId } from "@renderer/pages/game-details/modals/game-options-modal/types";

import { CloudSyncContextProvider } from "../cloud-sync/cloud-sync.context";
import {
  gameDetailsContext,
  GameDetailsContextProvider,
} from "../game-details/game-details.context";

export interface GameOptionsModalContext {
  openGameOptionsModal: (
    game: LibraryGame,
    initialCategory?: GameSettingsCategoryId
  ) => void;
}

export const gameOptionsModalContext = createContext<GameOptionsModalContext>({
  openGameOptionsModal: () => {},
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

export function GameOptionsModalProvider({
  children,
}: Readonly<GameOptionsModalProviderProps>) {
  const navigate = useNavigate();
  const [target, setTarget] = useState<GameOptionsModalTarget | null>(null);

  const openGameOptionsModal = useCallback(
    (game: LibraryGame, initialCategory: GameSettingsCategoryId = "general") =>
      setTarget({ game, initialCategory }),
    []
  );

  const closeGameOptionsModal = useCallback(() => setTarget(null), []);

  const value = useMemo(
    () => ({ openGameOptionsModal }),
    [openGameOptionsModal]
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
        </GameDetailsContextProvider>
      )}
    </Provider>
  );
}
