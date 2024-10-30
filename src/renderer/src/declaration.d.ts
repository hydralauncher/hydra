import type { CatalogueCategory } from "@shared";
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
  UserProfile,
  FriendRequest,
  FriendRequestAction,
  UserFriends,
  UserBlocks,
  UpdateProfileRequest,
  GameStats,
  TrendingGame,
  UserStats,
  UserDetails,
  FriendRequestSync,
  GameAchievement,
  GameArtifact,
  LudusaviBackup,
  UserAchievement,
  ComparedAchievements,
} from "@types";
import type { AxiosProgressEvent } from "axios";
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
    getCatalogue: (category: CatalogueCategory) => Promise<CatalogueEntry[]>;
    getGameShopDetails: (
      objectId: string,
      shop: GameShop,
      language: string
    ) => Promise<ShopDetails | null>;
    getRandomGame: () => Promise<Steam250Game>;
    getHowLongToBeat: (
      title: string
    ) => Promise<HowLongToBeatCategory[] | null>;
    getGames: (take?: number, skip?: number) => Promise<CatalogueEntry[]>;
    searchGameRepacks: (query: string) => Promise<GameRepack[]>;
    getGameStats: (objectId: string, shop: GameShop) => Promise<GameStats>;
    getTrendingGames: () => Promise<TrendingGame[]>;
    onUpdateAchievements: (
      objectId: string,
      shop: GameShop,
      cb: (achievements: GameAchievement[]) => void
    ) => () => Electron.IpcRenderer;

    /* Library */
    addGameToLibrary: (
      objectId: string,
      title: string,
      shop: GameShop
    ) => Promise<void>;
    createGameShortcut: (id: number) => Promise<boolean>;
    updateExecutablePath: (id: number, executablePath: string) => Promise<void>;
    selectGameWinePrefix: (id: number, winePrefixPath: string) => Promise<void>;
    verifyExecutablePathInUse: (executablePath: string) => Promise<Game>;
    getLibrary: () => Promise<LibraryGame[]>;
    openGameInstaller: (gameId: number) => Promise<boolean>;
    openGameInstallerPath: (gameId: number) => Promise<boolean>;
    openGameExecutablePath: (gameId: number) => Promise<void>;
    openGame: (gameId: number, executablePath: string) => Promise<void>;
    closeGame: (gameId: number) => Promise<boolean>;
    removeGameFromLibrary: (gameId: number) => Promise<void>;
    removeGame: (gameId: number) => Promise<void>;
    deleteGameFolder: (gameId: number) => Promise<unknown>;
    getGameByObjectId: (objectId: string) => Promise<Game | null>;
    onGamesRunning: (
      cb: (
        gamesRunning: Pick<GameRunning, "id" | "sessionDurationInMillis">[]
      ) => void
    ) => () => Electron.IpcRenderer;
    onLibraryBatchComplete: (cb: () => void) => () => Electron.IpcRenderer;

    /* User preferences */
    getUserPreferences: () => Promise<UserPreferences | null>;
    updateUserPreferences: (
      preferences: Partial<UserPreferences>
    ) => Promise<void>;
    autoLaunch: (enabled: boolean) => Promise<void>;
    authenticateRealDebrid: (apiToken: string) => Promise<RealDebridUser>;

    /* Download sources */
    getDownloadSources: () => Promise<DownloadSource[]>;
    deleteDownloadSource: (id: number) => Promise<void>;

    /* Hardware */
    getDiskFreeSpace: (path: string) => Promise<DiskSpace>;

    /* Cloud save */
    uploadSaveGame: (
      objectId: string,
      shop: GameShop,
      downloadOptionTitle: string | null
    ) => Promise<void>;
    downloadGameArtifact: (
      objectId: string,
      shop: GameShop,
      gameArtifactId: string
    ) => Promise<void>;
    getGameArtifacts: (
      objectId: string,
      shop: GameShop
    ) => Promise<GameArtifact[]>;
    getGameBackupPreview: (
      objectId: string,
      shop: GameShop
    ) => Promise<LudusaviBackup | null>;
    deleteGameArtifact: (gameArtifactId: string) => Promise<{ ok: boolean }>;
    selectGameBackupPath: (
      shop: GameShop,
      objectId: string,
      backupPath: string | null
    ) => Promise<void>;
    onBackupDownloadComplete: (
      objectId: string,
      shop: GameShop,
      cb: () => void
    ) => () => Electron.IpcRenderer;
    onUploadComplete: (
      objectId: string,
      shop: GameShop,
      cb: () => void
    ) => () => Electron.IpcRenderer;
    onBackupDownloadProgress: (
      objectId: string,
      shop: GameShop,
      cb: (progress: AxiosProgressEvent) => void
    ) => () => Electron.IpcRenderer;

    /* Misc */
    openExternal: (src: string) => Promise<void>;
    openCheckout: () => Promise<void>;
    getVersion: () => Promise<string>;
    ping: () => string;
    getDefaultDownloadsPath: () => Promise<string>;
    isPortableVersion: () => Promise<boolean>;
    showOpenDialog: (
      options: Electron.OpenDialogOptions
    ) => Promise<Electron.OpenDialogReturnValue>;
    showItemInFolder: (path: string) => Promise<void>;
    platform: NodeJS.Platform;

    /* Auto update */
    onAutoUpdaterEvent: (
      cb: (event: AppUpdaterEvent) => void
    ) => () => Electron.IpcRenderer;
    checkForUpdates: () => Promise<boolean>;
    restartAndInstallUpdate: () => Promise<void>;

    /* Auth */
    signOut: () => Promise<void>;
    openAuthWindow: () => Promise<void>;
    getSessionHash: () => Promise<string | null>;
    onSignIn: (cb: () => void) => () => Electron.IpcRenderer;
    onSignOut: (cb: () => void) => () => Electron.IpcRenderer;

    /* User */
    getUser: (userId: string) => Promise<UserProfile | null>;
    blockUser: (userId: string) => Promise<void>;
    unblockUser: (userId: string) => Promise<void>;
    getUserFriends: (
      userId: string,
      take: number,
      skip: number
    ) => Promise<UserFriends>;
    getBlockedUsers: (take: number, skip: number) => Promise<UserBlocks>;
    getUserStats: (userId: string) => Promise<UserStats>;
    reportUser: (
      userId: string,
      reason: string,
      description: string
    ) => Promise<void>;
    getComparedUnlockedAchievements: (
      objectId: string,
      shop: GameShop,
      userId: string
    ) => Promise<ComparedAchievements>;
    getUnlockedAchievements: (
      objectId: string,
      shop: GameShop
    ) => Promise<UserAchievement[]>;

    /* Profile */
    getMe: () => Promise<UserDetails | null>;
    undoFriendship: (userId: string) => Promise<void>;
    updateProfile: (
      updateProfile: UpdateProfileRequest
    ) => Promise<UserProfile>;
    updateProfile: (updateProfile: UpdateProfileProps) => Promise<UserProfile>;
    processProfileImage: (
      path: string
    ) => Promise<{ imagePath: string; mimeType: string }>;
    getFriendRequests: () => Promise<FriendRequest[]>;
    syncFriendRequests: () => Promise<FriendRequestSync>;
    updateFriendRequest: (
      userId: string,
      action: FriendRequestAction
    ) => Promise<void>;
    sendFriendRequest: (userId: string) => Promise<void>;

    /* Notifications */
    publishNewRepacksNotification: (newRepacksCount: number) => Promise<void>;
  }

  interface Window {
    electron: Electron;
  }
}
