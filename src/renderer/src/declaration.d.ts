import type { AuthPage } from "@shared";
import type {
  AppUpdaterEvent,
  GameShop,
  Steam250Game,
  DownloadProgress,
  SeedingStatus,
  UserPreferences,
  StartGameDownloadPayload,
  RealDebridUser,
  UserProfile,
  FriendRequestAction,
  UpdateProfileRequest,
  GameStats,
  GameRepack,
  UserDetails,
  FriendRequestSync,
  NotificationSync,
  GameArtifact,
  LudusaviBackup,
  UserAchievement,
  ComparedAchievements,
  LibraryGame,
  GameRunning,
  TorBoxUser,
  Theme,
  Auth,
  ShortcutLocation,
  ShopAssets,
  ShopDetailsWithAssets,
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
  FriendNotificationInfo,
  Game,
  DiskUsage,
  DownloadSource,
  LocalNotification,
  GoogleDriveUserInfo,
  GoogleDriveBackupArtifact,
  RomEntry,
  RssFeed,
  NewsArticle,
} from "@types";
import type { AxiosProgressEvent } from "axios";

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
    addGameToQueue: (
      payload: StartGameDownloadPayload
    ) => Promise<{ ok: boolean; error?: string }>;
    cancelGameDownload: (shop: GameShop, objectId: string) => Promise<void>;
    pauseGameDownload: (shop: GameShop, objectId: string) => Promise<void>;
    resumeGameDownload: (shop: GameShop, objectId: string) => Promise<void>;
    pauseGameSeed: (shop: GameShop, objectId: string) => Promise<void>;
    resumeGameSeed: (shop: GameShop, objectId: string) => Promise<void>;
    updateDownloadQueuePosition: (
      shop: GameShop,
      objectId: string,
      direction: "up" | "down"
    ) => Promise<boolean>;
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
    getGameShopDetails: (
      objectId: string,
      shop: GameShop,
      language: string
    ) => Promise<ShopDetailsWithAssets | null>;
    getRandomGame: () => Promise<Steam250Game>;
    getGameStats: (objectId: string, shop: GameShop) => Promise<GameStats>;
    getGameAssets: (
      objectId: string,
      shop: GameShop
    ) => Promise<ShopAssets | null>;
    getGameRepacks: (shop: GameShop, objectId: string) => Promise<GameRepack[]>;
    onUpdateAchievements: (
      objectId: string,
      shop: GameShop,
      cb: (achievements: UserAchievement[]) => void
    ) => () => Electron.IpcRenderer;

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
    addCustomGameToLibrary: (
      title: string,
      executablePath: string,
      iconUrl?: string,
      logoImageUrl?: string,
      libraryHeroImageUrl?: string
    ) => Promise<Game>;
    updateCustomGame: (params: {
      shop: GameShop;
      objectId: string;
      title: string;
      iconUrl?: string;
      logoImageUrl?: string;
      libraryHeroImageUrl?: string;
      originalIconPath?: string;
      originalLogoPath?: string;
      originalHeroPath?: string;
    }) => Promise<Game>;
    copyCustomGameAsset: (
      sourcePath: string,
      assetType: "icon" | "logo" | "hero"
    ) => Promise<string>;
    cleanupUnusedAssets: () => Promise<{
      deletedCount: number;
      errors: string[];
    }>;
    updateGameCustomAssets: (params: {
      shop: GameShop;
      objectId: string;
      title: string;
      customIconUrl?: string | null;
      customLogoImageUrl?: string | null;
      customHeroImageUrl?: string | null;
      customOriginalIconPath?: string | null;
      customOriginalLogoPath?: string | null;
      customOriginalHeroPath?: string | null;
    }) => Promise<Game>;
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
    clearNewDownloadOptions: (
      shop: GameShop,
      objectId: string
    ) => Promise<void>;
    toggleGamePin: (
      shop: GameShop,
      objectId: string,
      pinned: boolean
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
    refreshLibraryAssets: () => Promise<void>;
    openGameInstaller: (shop: GameShop, objectId: string) => Promise<boolean>;
    runGameInstallerFile: (filePath: string) => Promise<boolean>;
    getGameInstallerActionType: (
      shop: GameShop,
      objectId: string
    ) => Promise<"install" | "open-folder" | "select-executable">;
    openGameInstallerPath: (shop: GameShop, objectId: string) => Promise<void>;
    openGameExecutablePath: (shop: GameShop, objectId: string) => Promise<void>;
    getGameSaveFolder: (
      shop: GameShop,
      objectId: string
    ) => Promise<string | null>;
    openGameSaveFolder: (
      shop: GameShop,
      objectId: string,
      saveFolderPath: string
    ) => Promise<boolean>;
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
    deleteGameInstaller: (
      shop: GameShop,
      objectId: string
    ) => Promise<{ ok: boolean; reason?: string }>;
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
    changeGamePlayTime: (
      shop: GameShop,
      objectId: string,
      playtimeInSeconds: number
    ) => Promise<void>;
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
    scanInstalledGames: () => Promise<{
      foundGames: { title: string; executablePath: string }[];
      total: number;
    }>;
    importSteamGames: () => Promise<{
      importedCount: number;
      totalFound: number;
      alreadyInLibrary: number;
    }>;
    onSteamImportProgress: (
      cb: (value: {
        totalGames: number;
        currentIndex: number;
        currentGame: string;
        importedCount: number;
        done: boolean;
      }) => void
    ) => () => Electron.IpcRenderer;
    onExtractionComplete: (
      cb: (shop: GameShop, objectId: string) => void
    ) => () => Electron.IpcRenderer;
    onExtractionProgress: (
      cb: (shop: GameShop, objectId: string, progress: number) => void
    ) => () => Electron.IpcRenderer;
    onArchiveDeletionPrompt: (
      cb: (archivePaths: string[], totalSizeInBytes: number) => void
    ) => () => Electron.IpcRenderer;
    onPasswordRequired: (
      cb: (shop: GameShop, objectId: string) => void
    ) => () => Electron.IpcRenderer;
    retryExtractionWithPassword: (
      shop: GameShop,
      objectId: string,
      password: string
    ) => Promise<void>;
    cancelExtraction: (shop: GameShop, objectId: string) => Promise<void>;
    deleteArchive: (filePath: string) => Promise<boolean>;
    getDefaultWinePrefixSelectionPath: () => Promise<string | null>;
    createSteamShortcut: (shop: GameShop, objectId: string) => Promise<void>;

    /* Download sources */
    addDownloadSource: (url: string) => Promise<DownloadSource>;
    removeDownloadSource: (
      removeAll = false,
      downloadSourceId?: string
    ) => Promise<void>;
    getDownloadSources: () => Promise<DownloadSource[]>;
    syncDownloadSources: () => Promise<void>;
    getDownloadSourcesCheckBaseline: () => Promise<string | null>;
    getDownloadSourcesSinceValue: () => Promise<string | null>;

    /* Hardware */
    getDiskFreeSpace: (path: string) => Promise<DiskUsage>;
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
    onUploadStarted: (
      objectId: string,
      shop: GameShop,
      cb: () => void
    ) => () => Electron.IpcRenderer;
    onUploadProgress: (
      objectId: string,
      shop: GameShop,
      cb: (progress: AxiosProgressEvent) => void
    ) => () => Electron.IpcRenderer;
    onBackupDownloadProgress: (
      objectId: string,
      shop: GameShop,
      cb: (progress: AxiosProgressEvent) => void
    ) => () => Electron.IpcRenderer;

    /* Google Drive */
    googleDrive: {
      authenticate: () => Promise<GoogleDriveUserInfo>;
      disconnect: () => Promise<void>;
      getConnectionStatus: () => Promise<{
        connected: boolean;
        userInfo: GoogleDriveUserInfo | null;
      }>;
      uploadSaveGame: (
        objectId: string,
        shop: GameShop,
        downloadOptionTitle: string | null
      ) => Promise<void>;
      downloadBackup: (
        objectId: string,
        shop: GameShop,
        fileId: string
      ) => Promise<void>;
      listBackups: (
        objectId: string,
        shop: GameShop
      ) => Promise<GoogleDriveBackupArtifact[]>;
      deleteBackup: (fileId: string) => Promise<void>;
    };
    /* Local Backup */
    localBackup: {
      uploadSaveGame: (
        objectId: string,
        shop: GameShop,
        downloadOptionTitle: string | null
      ) => Promise<void>;
      downloadBackup: (
        objectId: string,
        shop: GameShop,
        fileName: string
      ) => Promise<void>;
      listBackups: (
        objectId: string,
        shop: GameShop
      ) => Promise<GoogleDriveBackupArtifact[]>;
      deleteBackup: (fileName: string) => Promise<void>;
      selectPath: () => Promise<string | null>;
    };

    onGoogleDriveUploadComplete: (
      objectId: string,
      shop: GameShop,
      cb: () => void
    ) => () => Electron.IpcRenderer;

    /* Misc */
    setFullScreen: (flag: boolean) => Promise<void>;
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
    hydraApi: {
      get: <T = unknown>(
        url: string,
        options?: {
          params?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
          ifModifiedSince?: Date;
        }
      ) => Promise<T>;
      post: <T = unknown>(
        url: string,
        options?: {
          data?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
        }
      ) => Promise<T>;
      put: <T = unknown>(
        url: string,
        options?: {
          data?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
        }
      ) => Promise<T>;
      patch: <T = unknown>(
        url: string,
        options?: {
          data?: unknown;
          needsAuth?: boolean;
          needsSubscription?: boolean;
        }
      ) => Promise<T>;
      delete: <T = unknown>(
        url: string,
        options?: {
          needsAuth?: boolean;
          needsSubscription?: boolean;
        }
      ) => Promise<T>;
    };
    canInstallCommonRedist: () => Promise<boolean>;
    installCommonRedist: () => Promise<void>;
    installHydraDeckyPlugin: () => Promise<{
      success: boolean;
      path: string;
      currentVersion: string | null;
      expectedVersion: string;
      error?: string;
    }>;
    getHydraDeckyPluginInfo: () => Promise<{
      installed: boolean;
      version: string | null;
      path: string;
      outdated: boolean;
      expectedVersion: string | null;
    }>;
    checkHomebrewFolderExists: () => Promise<boolean>;
    onCommonRedistProgress: (
      cb: (value: { log: string; complete: boolean }) => void
    ) => () => Electron.IpcRenderer;
    onPreflightProgress: (
      cb: (value: { status: string; detail: string | null }) => void
    ) => () => Electron.IpcRenderer;
    resetCommonRedistPreflight: () => Promise<void>;
    saveTempFile: (fileName: string, fileData: Uint8Array) => Promise<string>;
    deleteTempFile: (filePath: string) => Promise<void>;
    openDevTools: () => Promise<void>;
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
    updateProfile: (
      updateProfile: UpdateProfileRequest
    ) => Promise<UserProfile>;
    updateProfile: (updateProfile: UpdateProfileProps) => Promise<UserProfile>;
    processProfileImage: (
      path: string
    ) => Promise<{ imagePath: string; mimeType: string }>;
    onSyncFriendRequests: (
      cb: (friendRequests: FriendRequestSync) => void
    ) => () => Electron.IpcRenderer;
    onSyncNotificationCount: (
      cb: (notification: NotificationSync) => void
    ) => () => Electron.IpcRenderer;
    updateFriendRequest: (
      userId: string,
      action: FriendRequestAction
    ) => Promise<void>;

    /* Notifications */
    publishNewRepacksNotification: (newRepacksCount: number) => Promise<void>;
    getLocalNotifications: () => Promise<LocalNotification[]>;
    getLocalNotificationsCount: () => Promise<number>;
    markLocalNotificationRead: (id: string) => Promise<void>;
    markAllLocalNotificationsRead: () => Promise<void>;
    deleteLocalNotification: (id: string) => Promise<void>;
    clearAllLocalNotifications: () => Promise<void>;
    onLocalNotificationCreated: (
      cb: (notification: LocalNotification) => void
    ) => () => Electron.IpcRenderer;
    onAchievementUnlocked: (
      cb: (
        position?: AchievementCustomNotificationPosition,
        achievements?: AchievementNotificationInfo[]
      ) => void
    ) => () => Electron.IpcRenderer;
    onCombinedAchievementsUnlocked: (
      cb: (
        gameCount: number,
        achievementCount: number,
        position: AchievementCustomNotificationPosition
      ) => void
    ) => () => Electron.IpcRenderer;
    onFriendStartedPlaying: (
      cb: (
        position?: AchievementCustomNotificationPosition,
        friendInfo?: FriendNotificationInfo
      ) => void
    ) => () => Electron.IpcRenderer;
    updateAchievementCustomNotificationWindow: () => Promise<void>;
    showAchievementTestNotification: () => Promise<void>;
    showFriendTestNotification: () => Promise<void>;

    /* Themes */
    addCustomTheme: (theme: Theme) => Promise<void>;
    getAllCustomThemes: () => Promise<Theme[]>;
    deleteAllCustomThemes: () => Promise<void>;
    deleteCustomTheme: (themeId: string) => Promise<void>;
    updateCustomTheme: (themeId: string, code: string) => Promise<void>;
    getCustomThemeById: (themeId: string) => Promise<Theme | null>;
    getActiveCustomTheme: () => Promise<Theme | null>;
    toggleCustomTheme: (themeId: string, isActive: boolean) => Promise<void>;
    copyThemeAchievementSound: (
      themeId: string,
      sourcePath: string
    ) => Promise<void>;
    removeThemeAchievementSound: (themeId: string) => Promise<void>;
    getThemeSoundPath: (themeId: string) => Promise<string | null>;
    getThemeSoundDataUrl: (themeId: string) => Promise<string | null>;
    importThemeSoundFromStore: (
      themeId: string,
      themeName: string,
      storeUrl: string
    ) => Promise<void>;

    /* Editor */
    openEditorWindow: (themeId: string) => Promise<void>;
    onCustomThemeUpdated: (cb: () => void) => () => Electron.IpcRenderer;
    closeEditorWindow: (themeId?: string) => Promise<void>;

    /* Game Launcher Window */
    showGameLauncherWindow: () => Promise<void>;
    closeGameLauncherWindow: () => Promise<void>;
    openMainWindow: () => Promise<void>;
    isMainWindowOpen: () => Promise<boolean>;

    /* Download Options */
    onNewDownloadOptions: (
      cb: (gamesWithNewOptions: { gameId: string; count: number }[]) => void
    ) => () => Electron.IpcRenderer;

    /* News */
    news: {
      getFeeds: () => Promise<RssFeed[]>;
      addFeed: (name: string, url: string) => Promise<RssFeed>;
      removeFeed: (feedId: string) => Promise<void>;
      fetchArticles: () => Promise<NewsArticle[]>;
      seedDefaultFeeds: () => Promise<void>;
      scrapeArticle: (url: string) => Promise<{ content: string } | null>;
      translateText: (
        text: string,
        targetLang: string
      ) => Promise<{
        translatedText: string;
        detectedLanguage: string | null;
      }>;
    };

    /* ROMs (Beta) */
    roms: {
      scan: (romsPath: string) => Promise<RomEntry[]>;
      getAll: () => Promise<RomEntry[]>;
      getById: (id: string) => Promise<RomEntry | null>;
      selectFolder: () => Promise<string | null>;
      selectBiosFolder: () => Promise<string | null>;
      delete: (id: string) => Promise<void>;
      updatePlaytime: (
        id: string,
        deltaInMilliseconds: number
      ) => Promise<void>;
      toggleFavorite: (id: string) => Promise<boolean>;
      getEmulatorDataPath: () => Promise<string>;
      updateTitle: (id: string, newTitle: string) => Promise<RomEntry | null>;
      scrape: (id: string, searchTitle: string) => Promise<RomEntry | null>;
      uploadSaves: () => Promise<void>;
      downloadSaves: (artifactId: string) => Promise<void>;
      getSavesInfo: () => Promise<{
        sizeInBytes: number;
        lastModified: string | null;
      }>;
      listSaveBackups: () => Promise<GoogleDriveBackupArtifact[]>;
      deleteSaveBackup: (fileName: string) => Promise<void>;
      saveGameSRAM: (romId: string, data: number[]) => Promise<void>;
      loadGameSRAM: (romId: string) => Promise<number[] | null>;
      saveGameState: (
        romId: string,
        slot: number,
        data: number[]
      ) => Promise<void>;
      loadGameState: (romId: string, slot: number) => Promise<number[] | null>;
    };

    /* LevelDB Generic CRUD */
    leveldb: {
      get: (
        key: string,
        sublevelName?: string | null,
        valueEncoding?: "json" | "utf8"
      ) => Promise<unknown>;
      put: (
        key: string,
        value: unknown,
        sublevelName?: string | null,
        valueEncoding?: "json" | "utf8"
      ) => Promise<void>;
      del: (key: string, sublevelName?: string | null) => Promise<void>;
      clear: (sublevelName: string) => Promise<void>;
      values: (sublevelName: string) => Promise<unknown[]>;
      iterator: (sublevelName: string) => Promise<[string, unknown][]>;
    };
  }

  interface Window {
    electron: Electron;
  }
}
