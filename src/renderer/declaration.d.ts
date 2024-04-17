import type {
  CatalogueEntry,
  GameShop,
  Game,
  CatalogueCategory,
  TorrentProgress,
  ShopDetails,
  UserPreferences,
  HowLongToBeatCategory,
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
      shop: GameShop
    ) => Promise<Game>;
    cancelGameDownload: (gameId: number) => Promise<void>;
    pauseGameDownload: (gameId: number) => Promise<void>;
    resumeGameDownload: (gameId: number) => Promise<void>;
    onDownloadProgress: (
      cb: (value: TorrentProgress) => void
    ) => () => Electron.IpcRenderer;

    /* Catalogue */
    searchGames: (query: string) => Promise<CatalogueEntry[]>;
    getCatalogue: (category: CatalogueCategory) => Promise<CatalogueEntry[]>;
    getGameShopDetails: (
      objectID: string,
      shop: GameShop,
      language: string
    ) => Promise<ShopDetails | null>;
    getRandomGame: () => Promise<string>;
    getHowLongToBeat: (
      objectID: string,
      shop: GameShop,
      title: string
    ) => Promise<HowLongToBeatCategory[] | null>;

    /* Library */
    addGameToLibrary: (
      objectID: string,
      title: string,
      shop: GameShop
    ) => Promise<void>;
    getLibrary: () => Promise<Game[]>;
    getRepackersFriendlyNames: () => Promise<Record<string, string>>;
    openGameInstaller: (gameId: number) => Promise<boolean>;
    openGame: (gameId: number, path: string) => Promise<void>;
    removeGame: (gameId: number) => Promise<void>;
    deleteGameFolder: (gameId: number) => Promise<unknown>;
    getGameByObjectID: (objectID: string) => Promise<Game | null>;
    onPlayTime: (cb: (gameId: number) => void) => () => Electron.IpcRenderer;

    /* User preferences */
    getUserPreferences: () => Promise<UserPreferences | null>;
    updateUserPreferences: (
      preferences: Partial<UserPreferences>
    ) => Promise<void>;

    /* Hardware */
    getDiskFreeSpace: () => Promise<DiskSpace>;

    /* Misc */
    getOrCacheImage: (url: string) => Promise<string>;
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
