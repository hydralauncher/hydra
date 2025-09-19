import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import type { GameFolder, GameFolderCreate, GameFolderUpdate } from "@types";

const STORAGE_KEY = "hydra-game-folders";

interface GameFoldersContextType {
  folders: GameFolder[];
  loading: boolean;
  createFolder: (folderData: GameFolderCreate) => GameFolder;
  updateFolder: (
    folderId: string,
    updates: GameFolderUpdate
  ) => GameFolder | null;
  deleteFolder: (folderId: string) => boolean;
  addGameToFolder: (folderId: string, gameId: string) => boolean;
  removeGameFromFolder: (folderId: string, gameId: string) => boolean;
  moveGameBetweenFolders: (
    gameId: string,
    fromFolderId: string | null,
    toFolderId: string | null
  ) => boolean;
  getUnorganizedGameIds: (allGameIds: string[]) => string[];
}

const GameFoldersContext = createContext<GameFoldersContextType | undefined>(
  undefined
);

interface GameFoldersProviderProps {
  children: ReactNode;
}

export function GameFoldersProvider({ children }: GameFoldersProviderProps) {
  const [folders, setFolders] = useState<GameFolder[]>([]);
  const [loading, setLoading] = useState(true);

  // Carregar pastas do localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsedFolders = JSON.parse(stored).map((folder: any) => ({
          ...folder,
          createdAt: new Date(folder.createdAt),
          updatedAt: new Date(folder.updatedAt),
        }));
        setFolders(parsedFolders);
      }
    } catch (error) {
      console.error("Erro ao carregar pastas:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Salvar pastas no localStorage
  const saveFolders = useCallback((newFolders: GameFolder[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newFolders));
      setFolders(newFolders);
    } catch (error) {
      console.error("Erro ao salvar pastas:", error);
    }
  }, []);

  // Criar nova pasta
  const createFolder = useCallback(
    (folderData: GameFolderCreate): GameFolder => {
      const newFolder: GameFolder = {
        id: crypto.randomUUID(),
        ...folderData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedFolders = [...folders, newFolder];
      saveFolders(updatedFolders);
      return newFolder;
    },
    [folders, saveFolders]
  );

  // Atualizar pasta existente
  const updateFolder = useCallback(
    (folderId: string, updates: GameFolderUpdate): GameFolder | null => {
      const folderIndex = folders.findIndex((f) => f.id === folderId);
      if (folderIndex === -1) return null;

      const updatedFolder: GameFolder = {
        ...folders[folderIndex],
        ...updates,
        updatedAt: new Date(),
      };

      const updatedFolders = [...folders];
      updatedFolders[folderIndex] = updatedFolder;
      saveFolders(updatedFolders);
      return updatedFolder;
    },
    [folders, saveFolders]
  );

  // Deletar pasta
  const deleteFolder = useCallback(
    (folderId: string): boolean => {
      const updatedFolders = folders.filter((f) => f.id !== folderId);
      saveFolders(updatedFolders);
      return true;
    },
    [folders, saveFolders]
  );

  // Adicionar jogo à pasta
  const addGameToFolder = useCallback(
    (folderId: string, gameId: string): boolean => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder || folder.gameIds.includes(gameId)) return false;

      const updatedFolder: GameFolder = {
        ...folder,
        gameIds: [...folder.gameIds, gameId],
        updatedAt: new Date(),
      };

      const updatedFolders = folders.map((f) =>
        f.id === folderId ? updatedFolder : f
      );
      saveFolders(updatedFolders);
      return true;
    },
    [folders, saveFolders]
  );

  // Remover jogo da pasta
  const removeGameFromFolder = useCallback(
    (folderId: string, gameId: string): boolean => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder || !folder.gameIds.includes(gameId)) return false;

      const updatedFolder: GameFolder = {
        ...folder,
        gameIds: folder.gameIds.filter((id) => id !== gameId),
        updatedAt: new Date(),
      };

      const updatedFolders = folders.map((f) =>
        f.id === folderId ? updatedFolder : f
      );
      saveFolders(updatedFolders);
      return true;
    },
    [folders, saveFolders]
  );

  // Mover jogo entre pastas
  const moveGameBetweenFolders = useCallback(
    (
      gameId: string,
      fromFolderId: string | null,
      toFolderId: string | null
    ): boolean => {
      let updatedFolders = [...folders];

      // Remover da pasta origem (se especificada)
      if (fromFolderId) {
        const fromFolder = updatedFolders.find((f) => f.id === fromFolderId);
        if (fromFolder && fromFolder.gameIds.includes(gameId)) {
          const updatedFromFolder: GameFolder = {
            ...fromFolder,
            gameIds: fromFolder.gameIds.filter((id) => id !== gameId),
            updatedAt: new Date(),
          };
          updatedFolders = updatedFolders.map((f) =>
            f.id === fromFolderId ? updatedFromFolder : f
          );
        }
      }

      // Adicionar à pasta destino (se especificada)
      if (toFolderId) {
        const toFolder = updatedFolders.find((f) => f.id === toFolderId);
        if (toFolder && !toFolder.gameIds.includes(gameId)) {
          const updatedToFolder: GameFolder = {
            ...toFolder,
            gameIds: [...toFolder.gameIds, gameId],
            updatedAt: new Date(),
          };
          updatedFolders = updatedFolders.map((f) =>
            f.id === toFolderId ? updatedToFolder : f
          );
        }
      }

      saveFolders(updatedFolders);
      return true;
    },
    [folders, saveFolders]
  );

  // Obter IDs de jogos não organizados
  const getUnorganizedGameIds = useCallback(
    (allGameIds: string[]): string[] => {
      const organizedGameIds = new Set<string>();
      folders.forEach((folder) => {
        folder.gameIds.forEach((gameId) => organizedGameIds.add(gameId));
      });
      return allGameIds.filter((gameId) => !organizedGameIds.has(gameId));
    },
    [folders]
  );

  const value: GameFoldersContextType = {
    folders,
    loading,
    createFolder,
    updateFolder,
    deleteFolder,
    addGameToFolder,
    removeGameFromFolder,
    moveGameBetweenFolders,
    getUnorganizedGameIds,
  };

  return (
    <GameFoldersContext.Provider value={value}>
      {children}
    </GameFoldersContext.Provider>
  );
}

export function useGameFoldersContext(): GameFoldersContextType {
  const context = useContext(GameFoldersContext);
  if (context === undefined) {
    throw new Error(
      "useGameFoldersContext deve ser usado dentro de um GameFoldersProvider"
    );
  }
  return context;
}
