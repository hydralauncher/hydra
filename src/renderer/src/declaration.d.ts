import type { AuthPage, CatalogueCategory } from "@shared";
import type {
  AppUpdaterEvent,
  GameShop,
  HowLongToBeatCategory,
  Steam250Game,
  DownloadProgress,
  SeedingStatus,
  UserPreferences,
  StartGameDownloadPayload,
  RealDebridUser,
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
  GameArtifact,
  LudusaviBackup,
  UserAchievement,
  ComparedAchievements,
  CatalogueSearchPayload,
  LibraryGame,
  GameRunning,
  TorBoxUser,
  Theme,
  Badge,
  Auth,
  ShortcutLocation,
  CatalogueSearchResult,
  ShopAssets,
  ShopDetailsWithAssets,
} from "@types";
import type { AxiosProgressEvent } from "axios";
import type disk from "diskusage";

declare global {
  declare module "*.svg" {
    const content: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
    export default content;
  }

  interface Electron {
    /* Torrenting */
    startGameDownload: (
      payload: StartGameDownloadPayload
    ) => Promise<{ ok: boolean; error?: string }>;
    cancelGameDownload: (shop: GameShop, objectId: string) => Promise<void>;
    pauseGameDownload: (shop: GameShop, objectId: string) => Promise<void>;
    resumeGameDownload: (shop: GameShop, objectId: string) => Promise<void>;
    pauseGameSeed: (shop: GameShop, objectId: string) => Promise<void>;
    resumeGameSeed: (shop: GameShop, objectId: string) => Promise<void>;
    onDownloadProgress: (
      cb: (value: DownloadProgress | null) => void
    ) => () => Electron.IpcRenderer;
    onSeedingStatus: (
      cb: (value: SeedingStatus[]) => void
    ) => () => Electron.IpcRenderer;
    onHardDelete: (cb: () => void) => () => Electron.IpcRenderer;
    checkDebridAvailability: (
      magnets: string[]
    ) => Promise<Record<string, boolean>>;

    /* Catalogue */
    searchGames: (
      payload: CatalogueSearchPayload,
      take: number,
      skip: number
    ) => Promise<{ edges: CatalogueSearchResult[]; count: number }>;
    getCatalogue: (category: CatalogueCategory) => Promise<ShopAssets[]>;
    saveGameShopAssets: (
      objectId: string,
      shop: GameShop,
      assets: ShopAssets
    ) => Promise<void>;
    getGameShopDetails: (
      objectId: string,
      shop: GameShop,
      language: string
    ) => Promise<ShopDetailsWithAssets | null>;
    getRandomGame: () => Promise<Steam250Game>;
    getHowLongToBeat: (
      objectId: string,
      shop: GameShop
    ) => Promise<HowLongToBeatCategory[] | null>;
    getGameStats: (objectId: string, shop: GameShop) => Promise<GameStats>;
    getTrendingGames: () => Promise<TrendingGame[]>;
    onUpdateAchievements: (
      objectId: string,
      shop: GameShop,
      cb: (achievements: UserAchievement[]) => void
    ) => () => Electron.IpcRenderer;
    getPublishers: () => Promise<string[]>;
    getDevelopers: () => Promise<string[]>;

    /* Library */
    toggleAutomaticCloudSync: (
      shop: GameShop,
      objectId: string,
      automaticCloudSync: boolean
    ) => Promise<void>;
    addGameToLibrary: (
      shop: GameShop,
      objectId: string,
      title: string
    ) => Promise<void>;
    createGameShortcut: (
      shop: GameShop,
      objectId: string,
      location: ShortcutLocation
    ) => Promise<boolean>;
    updateExecutablePath: (
      shop: GameShop,
      objectId: string,
      executablePath: string | null
    ) => Promise<void>;
    addGameToFavorites: (shop: GameShop, objectId: string) => Promise<void>;
    removeGameFromFavorites: (
      shop: GameShop,
      objectId: string
    ) => Promise<void>;
    updateLaunchOptions: (
      shop: GameShop,
      objectId: string,
      launchOptions: string | null
    ) => Promise<void>;
    selectGameWinePrefix: (
      shop: GameShop,
      objectId: string,
      winePrefixPath: string | null
    ) => Promise<void>;
    verifyExecutablePathInUse: (executablePath: string) => Promise<Game>;
    getLibrary: () => Promise<LibraryGame[]>;
    openGameInstaller: (shop: GameShop, objectId: string) => Promise<boolean>;
    openGameInstallerPath: (
      shop: GameShop,
      objectId: string
    ) => Promise<boolean>;
    openGameExecutablePath: (shop: GameShop, objectId: string) => Promise<void>;
    openGame: (
      shop: GameShop,
      objectId: string,
      executablePath: string,
      launchOptions?: string | null
    ) => Promise<void>;
    closeGame: (shop: GameShop, objectId: string) => Promise<boolean>;
    removeGameFromLibrary: (shop: GameShop, objectId: string) => Promise<void>;
    removeGame: (shop: GameShop, objectId: string) => Promise<void>;
    deleteGameFolder: (shop: GameShop, objectId: string) => Promise<unknown>;
    getGameByObjectId: (
      shop: GameShop,
      objectId: string
    ) => Promise<LibraryGame | null>;
    onGamesRunning: (
      cb: (
        gamesRunning: Pick<GameRunning, "id" | "sessionDurationInMillis">[]
      ) => void
    ) => () => Electron.IpcRenderer;
    onLibraryBatchComplete: (cb: () => void) => () => Electron.IpcRenderer;
    resetGameAchievements: (shop: GameShop, objectId: string) => Promise<void>;
    /* User preferences */
    authenticateRealDebrid: (apiToken: string) => Promise<RealDebridUser>;
    authenticateTorBox: (apiToken: string) => Promise<TorBoxUser>;
    getUserPreferences: () => Promise<UserPreferences | null>;
    updateUserPreferences: (
      preferences: Partial<UserPreferences>
    ) => Promise<void>;
    autoLaunch: (autoLaunchProps: {
      enabled: boolean;
      minimized: boolean;
    }) => Promise<void>;
    extractGameDownload: (shop: GameShop, objectId: string) => Promise<boolean>;
    onAchievementUnlocked: (cb: () => void) => () => Electron.IpcRenderer;
    onExtractionComplete: (
      cb: (shop: GameShop, objectId: string) => void
    ) => () => Electron.IpcRenderer;
    getDefaultWinePrefixSelectionPath: () => Promise<string | null>;
    createSteamShortcut: (shop: GameShop, objectId: string) => Promise<void>;

    /* Download sources */
    putDownloadSource: (
      objectIds: string[]
    ) => Promise<{ fingerprint: string }>;
    createDownloadSources: (urls: string[]) => Promise<void>;
    removeDownloadSource: (url: string, removeAll?: boolean) => Promise<void>;
    getDownloadSources: () => Promise<
      Pick<DownloadSource, "url" | "createdAt" | "updatedAt">[]
    >;

    /* Hardware */
    getDiskFreeSpace: (path: string) => Promise<disk.DiskUsage>;
    checkFolderWritePermission: (path: string) => Promise<boolean>;

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
    isStaging: () => Promise<boolean>;
    ping: () => string;
    getDefaultDownloadsPath: () => Promise<string>;
    isPortableVersion: () => Promise<boolean>;
    showOpenDialog: (
      options: Electron.OpenDialogOptions
    ) => Promise<Electron.OpenDialogReturnValue>;
    showItemInFolder: (path: string) => Promise<void>;
    getFeatures: () => Promise<string[]>;
    getBadges: () => Promise<Badge[]>;
    canInstallCommonRedist: () => Promise<boolean>;
    installCommonRedist: () => Promise<void>;
    onCommonRedistProgress: (
      cb: (value: { log: string; complete: boolean }) => void
    ) => () => Electron.IpcRenderer;
    platform: NodeJS.Platform;

    /* Auto update */
    onAutoUpdaterEvent: (
      cb: (event: AppUpdaterEvent) => void
    ) => () => Electron.IpcRenderer;
    checkForUpdates: () => Promise<boolean>;
    restartAndInstallUpdate: () => Promise<void>;

    /* Auth */
    getAuth: () => Promise<Auth | null>;
    signOut: () => Promise<void>;
    openAuthWindow: (page: AuthPage) => Promise<void>;
    getSessionHash: () => Promise<string | null>;
    onSignIn: (cb: () => void) => () => Electron.IpcRenderer;
    onAccountUpdated: (cb: () => void) => () => Electron.IpcRenderer;
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
    syncFriendRequests: () => Promise<void>;
    onSyncFriendRequests: (
      cb: (friendRequests: FriendRequestSync) => void
    ) => () => Electron.IpcRenderer;
    updateFriendRequest: (
      userId: string,
      action: FriendRequestAction
    ) => Promise<void>;
    sendFriendRequest: (userId: string) => Promise<void>;

    /* Notifications */
    publishNewRepacksNotification: (newRepacksCount: number) => Promise<void>;

    /* Themes */
    addCustomTheme: (theme: Theme) => Promise<void>;
    getAllCustomThemes: () => Promise<Theme[]>;
    deleteAllCustomThemes: () => Promise<void>;
    deleteCustomTheme: (themeId: string) => Promise<void>;
    updateCustomTheme: (themeId: string, code: string) => Promise<void>;
    getCustomThemeById: (themeId: string) => Promise<Theme | null>;
    getActiveCustomTheme: () => Promise<Theme | null>;
    toggleCustomTheme: (themeId: string, isActive: boolean) => Promise<void>;

    /* Editor */
    openEditorWindow: (themeId: string) => Promise<void>;
    onCssInjected: (
      cb: (cssString: string) => void
    ) => () => Electron.IpcRenderer;
    closeEditorWindow: (themeId?: string) => Promise<void>;
  }

  interface Window {
    electron: Electron;
  }
}
