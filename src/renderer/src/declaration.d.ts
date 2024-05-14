import type {
  CatalogueCategory,
  CatalogueEntry,
  Game,
  GameRepack,
  GameShop,
  HowLongToBeatCategory,
  ShopDetails,
  Steam250Game,
  TorrentProgress,
  UserPreferences,
} from "@types";
import type { DiskSpace } from "check-disk-space";

declare global {
  declare module "*.svg" {
    const content: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
    export default content;
  }

  interface Electron {
    /* Torrenting */
    startGameDownload: (
      repackId: number,
      objectID: string,
      title: string,
      shop: GameShop,
      downloadPath: string
    ) => Promise<Game>;
    cancelGameDownload: (gameId: number) => Promise<void>;
    pauseGameDownload: (gameId: number) => Promise<void>;
    resumeGameDownload: (gameId: number) => Promise<void>;
    onDownloadProgress: (
      cb: (value: TorrentProgress) => void
    ) => () => Electron.IpcRenderer;

    /* Catalogue */
    searchGames: (query: string, page?: number) => Promise<CatalogueEntry[]>;
    getCatalogue: (category: CatalogueCategory) => Promise<CatalogueEntry[]>;
    getGameShopDetails: (
      objectID: string,
      shop: GameShop,
      language: string
    ) => Promise<ShopDetails | null>;
    getRandomGame: () => Promise<Steam250Game>;
    getHowLongToBeat: (
      objectID: string,
      shop: GameShop,
      title: string
    ) => Promise<HowLongToBeatCategory[] | null>;
    getGames: (
      take?: number,
      prevCursor?: number
    ) => Promise<{ results: CatalogueEntry[]; cursor: number }>;
    searchGameRepacks: (query: string) => Promise<GameRepack[]>;

    /* Library */
    addGameToLibrary: (
      objectID: string,
      title: string,
      shop: GameShop,
      executablePath: string | null
    ) => Promise<void>;
    getLibrary: () => Promise<Game[]>;
    getRepackersFriendlyNames: () => Promise<Record<string, string>>;
    openGameInstaller: (gameId: number) => Promise<boolean>;
    openGame: (gameId: number, executablePath: string) => Promise<void>;
    closeGame: (gameId: number) => Promise<boolean>;
    removeGameFromLibrary: (gameId: number) => Promise<void>;
    deleteGameFolder: (gameId: number) => Promise<unknown>;
    getGameByObjectID: (objectID: string) => Promise<Game | null>;
    onPlaytime: (cb: (gameId: number) => void) => () => Electron.IpcRenderer;
    onGameClose: (cb: (gameId: number) => void) => () => Electron.IpcRenderer;

    /* User preferences */
    getUserPreferences: () => Promise<UserPreferences | null>;
    updateUserPreferences: (
      preferences: Partial<UserPreferences>
    ) => Promise<void>;
    autoLaunch: (enabled: boolean) => Promise<void>;

    /* Hardware */
    getDiskFreeSpace: (path: string) => Promise<DiskSpace>;

    /* Misc */
    openExternal: (src: string) => Promise<void>;
    getVersion: () => Promise<string>;
    ping: () => string;
    getDefaultDownloadsPath: () => Promise<string>;
    showOpenDialog: (
      options: Electron.OpenDialogOptions
    ) => Promise<Electron.OpenDialogReturnValue>;
    platform: NodeJS.Platform;
  }

  interface Window {
    electron: Electron;
  }
}
