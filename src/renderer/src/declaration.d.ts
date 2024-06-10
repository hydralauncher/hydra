import type {
  AppUpdaterEvent,
  CatalogueEntry,
  Game,
  LibraryGame,
  GameRepack,
  GameShop,
  HowLongToBeatCategory,
  ShopDetails,
  Steam250Game,
  DownloadProgress,
  UserPreferences,
  StartGameDownloadPayload,
  RealDebridUser,
  DownloadSource,
} from "@types";
import type { DiskSpace } from "check-disk-space";

declare global {
  declare module "*.svg" {
    const content: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
    export default content;
  }

  interface Electron {
    /* Torrenting */
    startGameDownload: (payload: StartGameDownloadPayload) => Promise<void>;
    cancelGameDownload: (gameId: number) => Promise<void>;
    pauseGameDownload: (gameId: number) => Promise<void>;
    resumeGameDownload: (gameId: number) => Promise<void>;
    onDownloadProgress: (
      cb: (value: DownloadProgress) => void
    ) => () => Electron.IpcRenderer;

    /* Catalogue */
    searchGames: (query: string) => Promise<CatalogueEntry[]>;
    getCatalogue: () => Promise<CatalogueEntry[]>;
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
      shop: GameShop
    ) => Promise<void>;
    createGameShortcut: (id: number) => Promise<boolean>;
    updateExecutablePath: (id: number, executablePath: string) => Promise<void>;
    getLibrary: () => Promise<LibraryGame[]>;
    openGameInstaller: (gameId: number) => Promise<boolean>;
    openGameInstallerPath: (gameId: number) => Promise<boolean>;
    openGameExecutablePath: (gameId: number) => Promise<void>;
    openGame: (gameId: number, executablePath: string) => Promise<void>;
    closeGame: (gameId: number) => Promise<boolean>;
    removeGameFromLibrary: (gameId: number) => Promise<void>;
    removeGame: (gameId: number) => Promise<void>;
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
    authenticateRealDebrid: (apiToken: string) => Promise<RealDebridUser>;

    /* Download sources */
    getDownloadSources: () => Promise<DownloadSource[]>;
    validateDownloadSource: (
      url: string
    ) => Promise<{ name: string; downloadCount: number }>;
    addDownloadSource: (url: string) => Promise<DownloadSource>;
    removeDownloadSource: (id: number) => Promise<void>;
    syncDownloadSources: () => Promise<void>;

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

    /* Auto update */
    onAutoUpdaterEvent: (
      cb: (event: AppUpdaterEvent) => void
    ) => () => Electron.IpcRenderer;
    checkForUpdates: () => Promise<boolean>;
    restartAndInstallUpdate: () => Promise<void>;
    getMagnetHealth: (
      magnet: string
    ) => Promise<{ seeders: number; peers: number }>;
  }

  interface Window {
    electron: Electron;
  }
}
