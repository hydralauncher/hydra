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
  PremiumizeUser,
  AllDebridUser,
  UserProfile,
  UpdateProfileRequest,
  GameStats,
  UserDetails,
  FriendRequestSync,
  FriendPresenceSync,
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
  Ps2MemcardScanInput,
  Ps2MemcardScanProgress,
  Ps2MemoryCardSaveRecord,
  Ps2ExportResult,
  ShopAssets,
  ShopDetailsWithAssets,
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
  Game,
  DiskUsage,
  DownloadSource,
  LocalNotification,
  ProtonVersion,
  CreateSteamShortcutOptions,
  TorrentFilesResponse,
  DownloadLayoutState,
  EmulatorConfig,
  EmulatorConfigMap,
  EmulatorSystem,
  EmulationCloudSave,
  EmulationSavePlatform,
  MemcardRestoreResult,
  MemcardRestoreTarget,
} from "@types";
import type { AxiosProgressEvent } from "axios";

export interface DriveInfo {
  root: string;
  label: string;
  free: number;
  total: number;
}

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
    resumeGameDownload: (
      shop: GameShop,
      objectId: string,
      strategy?: "interruptActive" | "queueIfActive"
    ) => Promise<void>;
    pauseGameSeed: (shop: GameShop, objectId: string) => Promise<void>;
    resumeGameSeed: (shop: GameShop, objectId: string) => Promise<void>;
    updateDownloadQueuePosition: (
      shop: GameShop,
      objectId: string,
      direction: "up" | "down"
    ) => Promise<boolean>;
    setDownloadQueuePosition: (
      shop: GameShop,
      objectId: string,
      targetIndex: number
    ) => Promise<boolean>;
    setPausedDownloadPosition: (
      shop: GameShop,
      objectId: string,
      targetIndex: number
    ) => Promise<boolean>;
    moveDownloadPlacement: (
      shop: GameShop,
      objectId: string,
      targetArea: "hero" | "queue" | "paused",
      targetIndex?: number
    ) => Promise<boolean>;
    getDownloadLayoutState: () => Promise<DownloadLayoutState>;
    onDownloadProgress: (
      cb: (value: DownloadProgress | null) => void
    ) => () => Electron.IpcRenderer;
    onSeedingStatus: (
      cb: (value: SeedingStatus[]) => void
    ) => () => Electron.IpcRenderer;
    onHardDelete: (cb: () => void) => () => Electron.IpcRenderer;
    getTorrentFiles: (
      magnet: string
    ) => Promise<
      { ok: true; data: TorrentFilesResponse } | { ok: false; error: string }
    >;

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
    toggleGameMangohud: (
      shop: GameShop,
      objectId: string,
      autoRunMangohud: boolean
    ) => Promise<void>;
    toggleGameGamemode: (
      shop: GameShop,
      objectId: string,
      autoRunGamemode: boolean
    ) => Promise<void>;
    isGamemodeAvailable: () => Promise<boolean>;
    isMangohudAvailable: () => Promise<boolean>;
    isWinetricksAvailable: () => Promise<boolean>;
    addGameToLibrary: (
      shop: GameShop,
      objectId: string,
      title: string,
      platform?: string | null
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
    assignGameToCollection: (
      shop: GameShop,
      objectId: string,
      collectionIds: string[]
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
    selectGameProtonPath: (
      shop: GameShop,
      objectId: string,
      protonPath: string | null
    ) => Promise<void>;
    getInstalledProtonVersions: () => Promise<ProtonVersion[]>;
    getGameLaunchProtonVersion: (
      shop: GameShop,
      objectId: string
    ) => Promise<string | null>;
    verifyExecutablePathInUse: (executablePath: string) => Promise<Game>;
    getLibrary: () => Promise<LibraryGame[]>;
    refreshLibraryAssets: () => Promise<void>;
    openGameInstaller: (shop: GameShop, objectId: string) => Promise<boolean>;
    getGameInstallerActionType: (
      shop: GameShop,
      objectId: string
    ) => Promise<"install" | "open-folder">;
    openGameInstallerPath: (shop: GameShop, objectId: string) => Promise<void>;
    openGameWinetricks: (shop: GameShop, objectId: string) => Promise<boolean>;
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
    openClassicsGame: (
      shop: GameShop,
      objectId: string,
      discPath?: string,
      force?: boolean
    ) => Promise<void>;
    updateClassicsDisc: (
      shop: GameShop,
      objectId: string,
      patch: {
        selectedDiscPath?: string | null;
        dontAskDiscSelection?: boolean;
        platform?: string | null;
        addDisc?: { path: string; label: string; fileName: string };
        removeDiscPath?: string;
      }
    ) => Promise<LibraryGame>;
    getEmulatorRomExtensions: (
      system: "ps1" | "ps2" | "ps3"
    ) => Promise<string[]>;
    closeGame: (shop: GameShop, objectId: string) => Promise<boolean>;
    removeGameFromLibrary: (shop: GameShop, objectId: string) => Promise<void>;
    removeGame: (shop: GameShop, objectId: string) => Promise<void>;
    deleteGameFolder: (shop: GameShop, objectId: string) => Promise<unknown>;
    getGameByObjectId: (
      shop: GameShop,
      objectId: string
    ) => Promise<LibraryGame | null>;
    getGamesRunning: () => Promise<
      Pick<GameRunning, "id" | "sessionDurationInMillis">[]
    >;
    onGamesRunning: (
      cb: (
        gamesRunning: Pick<GameRunning, "id" | "sessionDurationInMillis">[]
      ) => void
    ) => () => Electron.IpcRenderer;
    onLibraryBatchComplete: (cb: () => void) => () => Electron.IpcRenderer;
    onDownloadsUpdated: (cb: () => void) => () => Electron.IpcRenderer;
    onClassicsImportStatus: (
      cb: (importing: boolean) => void
    ) => () => Electron.IpcRenderer;
    getClassicsImportStatus: () => Promise<boolean>;
    resetGameAchievements: (shop: GameShop, objectId: string) => Promise<void>;
    changeGamePlayTime: (
      shop: GameShop,
      objectId: string,
      playtimeInSeconds: number
    ) => Promise<void>;
    /* User preferences */
    authenticateRealDebrid: (apiToken: string) => Promise<RealDebridUser>;
    authenticatePremiumize: (apiToken: string) => Promise<PremiumizeUser>;
    authenticateAllDebrid: (apiToken: string) => Promise<AllDebridUser>;
    authenticateTorBox: (apiToken: string) => Promise<TorBoxUser>;
    getUserPreferences: () => Promise<UserPreferences | null>;
    updateUserPreferences: (
      preferences: Partial<UserPreferences>
    ) => Promise<void>;
    /* Emulators */
    getEmulatorConfigs: () => Promise<EmulatorConfigMap>;
    detectEmulators: () => Promise<EmulatorConfigMap>;
    detectEmulator: (system: EmulatorSystem) => Promise<EmulatorConfig>;
    previewEmulatorExecutable: (
      system: EmulatorSystem,
      executablePath?: string | null
    ) => Promise<{
      executablePath: string;
      detectedVersion: string | null;
    } | null>;
    setEmulatorExecutablePath: (
      system: EmulatorSystem,
      executablePath: string | null
    ) => Promise<EmulatorConfig>;
    addRomFolder: (
      system: EmulatorSystem,
      folderPath: string,
      scanSubfolders: boolean,
      language?: string
    ) => Promise<EmulatorConfig>;
    removeRomFolder: (
      system: EmulatorSystem,
      folderId: string
    ) => Promise<EmulatorConfig>;
    toggleRomFolderSubfolders: (
      system: EmulatorSystem,
      folderId: string,
      scanSubfolders: boolean
    ) => Promise<EmulatorConfig>;
    rescanEmulator: (
      system: EmulatorSystem,
      language?: string
    ) => Promise<EmulatorConfig>;
    checkPs3Firmware: (
      executablePath: string | null
    ) => Promise<{ installed: boolean }>;
    startRomScan: (
      system: EmulatorSystem,
      folderPath: string,
      scanSubfolders: boolean
    ) => Promise<{ requestId: string }>;
    cancelRomScan: (requestId: string) => Promise<void>;
    getEmulatorRomPaths: (system: EmulatorSystem) => Promise<string[]>;
    addEmulatorRomPath: (
      system: EmulatorSystem,
      folderPath: string
    ) => Promise<boolean>;
    getRpcs3DefaultSources: () => Promise<{
      gamesDir: string | null;
      gamesYmlPath: string | null;
      gamesYmlEntries: { titleId: string; path: string }[];
    }>;
    removeEmulator: (system: EmulatorSystem) => Promise<EmulatorConfig>;
    checkEmulatorExecutable: (
      system: EmulatorSystem
    ) => Promise<{ exists: boolean }>;
    onRomScanProgress: (
      requestId: string,
      cb: (
        payload:
          | {
              type: "progress";
              processed: number;
              total: number;
              currentFile: string | null;
            }
          | { type: "done"; fileCount: number; sizeBytes: number }
          | { type: "cancelled"; fileCount: number; sizeBytes: number }
          | { type: "error"; message: string }
      ) => void
    ) => () => Electron.IpcRenderer;
    importLaunchboxRoms: (
      system: EmulatorSystem,
      folders: { path: string; scanSubfolders: boolean }[],
      language: string
    ) => Promise<{ requestId: string }>;
    cancelLaunchboxImport: (requestId: string) => Promise<void>;
    onLaunchboxImportProgress: (
      requestId: string,
      cb: (
        payload:
          | {
              type: "scan_progress";
              phase: "scanning";
              processed: number;
              total: number;
              currentFile: string | null;
            }
          | {
              type: "match_progress";
              phase: "matching";
              processed: number;
              total: number;
              currentFile: string;
              status: "matched" | "unmatched";
              matched: number;
              unmatched: number;
              fileCount: number;
              sizeBytes: number;
            }
          | {
              type: "done";
              fileCount: number;
              sizeBytes: number;
              matched: number;
              unmatched: number;
              unmatchedFiles: string[];
            }
          | {
              type: "cancelled";
              fileCount: number;
              sizeBytes: number;
              matched: number;
              unmatched: number;
            }
          | { type: "error"; message: string }
      ) => void
    ) => () => Electron.IpcRenderer;
    scanPs2Memcards: (
      input: Ps2MemcardScanInput
    ) => Promise<{ requestId: string }>;
    cancelPs2MemcardScan: (requestId: string) => Promise<void>;
    onPs2MemcardScanProgress: (
      requestId: string,
      cb: (payload: Ps2MemcardScanProgress) => void
    ) => () => Electron.IpcRenderer;
    listPs2MemcardSaves: () => Promise<Ps2MemoryCardSaveRecord[]>;
    forgetPs2MemcardSave: (
      cardFilePath: string,
      folderName: string
    ) => Promise<void>;
    forgetPs2MemcardCard: (cardFilePath: string) => Promise<void>;
    exportPs2Save: (
      cardFilePath: string,
      folderName: string,
      suggestedName: string
    ) => Promise<Ps2ExportResult>;
    scanPs1Memcards: (
      input: Ps2MemcardScanInput
    ) => Promise<{ requestId: string }>;
    cancelPs1MemcardScan: (requestId: string) => Promise<void>;
    onPs1MemcardScanProgress: (
      requestId: string,
      cb: (payload: Ps2MemcardScanProgress) => void
    ) => () => Electron.IpcRenderer;
    listPs1MemcardSaves: () => Promise<Ps2MemoryCardSaveRecord[]>;
    forgetPs1MemcardSave: (
      cardFilePath: string,
      identifier: string
    ) => Promise<void>;
    forgetPs1MemcardCard: (cardFilePath: string) => Promise<void>;
    exportPs1Save: (
      cardFilePath: string,
      identifier: string,
      suggestedName: string
    ) => Promise<Ps2ExportResult>;
    uploadEmulationSave: (
      platform: EmulationSavePlatform,
      cardFilePath: string,
      folderName: string
    ) => Promise<EmulationCloudSave>;
    uploadEmulationSavesForCard: (
      platform: EmulationSavePlatform,
      cardFilePath: string
    ) => Promise<{ uploaded: number; total: number }>;
    listEmulationSaves: (
      platform: EmulationSavePlatform,
      objectId?: string | null
    ) => Promise<EmulationCloudSave[]>;
    getMemcardRestoreTargets: (
      platform: EmulationSavePlatform
    ) => Promise<MemcardRestoreTarget[]>;
    restoreEmulationSave: (
      platform: EmulationSavePlatform,
      saveId: string,
      targetCardFilePath: string
    ) => Promise<MemcardRestoreResult>;
    deleteEmulationSave: (saveId: string) => Promise<void>;
    updateEmulationSaveLabel: (
      saveId: string,
      label: string
    ) => Promise<EmulationCloudSave>;
    onUserPreferencesUpdated: (
      cb: (preferences: UserPreferences | null) => void
    ) => () => Electron.IpcRenderer;
    autoLaunch: (autoLaunchProps: {
      enabled: boolean;
      minimized: boolean;
    }) => Promise<void>;
    extractGameDownload: (shop: GameShop, objectId: string) => Promise<boolean>;
    scanInstalledGames: (
      additionalDirectories?: string[],
      includeDefaultDirectories?: boolean
    ) => Promise<{
      foundGames: { title: string; executablePath: string }[];
      total: number;
    }>;
    onExtractionComplete: (
      cb: (shop: GameShop, objectId: string) => void
    ) => () => Electron.IpcRenderer;
    onExtractionProgress: (
      cb: (shop: GameShop, objectId: string, progress: number) => void
    ) => () => Electron.IpcRenderer;
    onExtractionFailed: (
      cb: (shop: GameShop, objectId: string) => void
    ) => () => Electron.IpcRenderer;
    onArchiveDeletionPrompt: (
      cb: (archivePaths: string[]) => void
    ) => () => Electron.IpcRenderer;
    deleteArchive: (filePath: string) => Promise<boolean>;
    getDefaultWinePrefixSelectionPath: () => Promise<string | null>;
    createSteamShortcut: (
      shop: GameShop,
      objectId: string,
      options?: CreateSteamShortcutOptions
    ) => Promise<void>;
    deleteSteamShortcut: (shop: GameShop, objectId: string) => Promise<void>;
    checkSteamShortcut: (shop: GameShop, objectId: string) => Promise<boolean>;

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
    onBackupDownloadProgress: (
      objectId: string,
      shop: GameShop,
      cb: (progress: AxiosProgressEvent) => void
    ) => () => Electron.IpcRenderer;

    /* Clipboard */
    clipboard: {
      writeText: (text: string) => Promise<void>;
    };

    /* Misc */
    openExternal: (src: string) => Promise<void>;
    openCheckout: () => Promise<void>;
    getCloudIframeUrl: () => Promise<string>;
    getVersion: () => Promise<string>;
    isStaging: () => Promise<boolean>;
    ping: () => string;
    getDefaultDownloadsPath: () => Promise<string>;
    isPortableVersion: () => Promise<boolean>;
    showOpenDialog: (
      options: Electron.OpenDialogOptions
    ) => Promise<Electron.OpenDialogReturnValue>;
    showItemInFolder: (path: string) => Promise<void>;
    getImageDataUrl: (imageUrl: string) => Promise<string | null>;
    getProcessedFriendImage: (
      imageUrl: string | null,
      options: { width: number; height: number; preserveAnimation?: boolean }
    ) => Promise<string | null>;
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
    getProfileImageMetadata: (
      path: string
    ) => Promise<{ mimeType: string | null; isAnimated: boolean }>;
    processProfileImage: (
      path: string
    ) => Promise<{ imagePath: string; mimeType: string }>;
    cropProfileImage: (
      path: string,
      params: {
        left: number;
        top: number;
        width: number;
        height: number;
        outputWidth: number;
        outputHeight: number;
        rotation?: number;
      }
    ) => Promise<{ imagePath: string }>;
    onSyncFriendRequests: (
      cb: (friendRequests: FriendRequestSync) => void
    ) => () => Electron.IpcRenderer;
    onSyncNotificationCount: (
      cb: (notification: NotificationSync) => void
    ) => () => Electron.IpcRenderer;
    syncFriendRequests: (friendRequestCount: number) => Promise<void>;

    /* Notifications */
    publishNewRepacksNotification: (newRepacksCount: number) => Promise<void>;
    getLocalNotifications: () => Promise<LocalNotification[]>;
    getLocalNotificationsCount: () => Promise<number>;
    markLocalNotificationRead: (id: string) => Promise<void>;
    markLocalNotificationUnread: (id: string) => Promise<void>;
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
    onInAppAchievementUnlocked?: (
      cb: (
        position: AchievementCustomNotificationPosition,
        achievements: AchievementNotificationInfo[]
      ) => void
    ) => () => Electron.IpcRenderer;
    onCombinedAchievementsUnlocked: (
      cb: (
        gameCount: number,
        achievementCount: number,
        position: AchievementCustomNotificationPosition
      ) => void
    ) => () => Electron.IpcRenderer;
    updateAchievementCustomNotificationWindow: () => Promise<void>;
    showAchievementTestNotification: () => Promise<void>;

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

    /* Big Picture Window */
    openBigPictureWindow: () => Promise<void>;

    /* Friends Window */
    openFriendsWindow: () => Promise<void>;
    minimizeFriendsWindow: () => Promise<void>;
    closeFriendsWindow: () => Promise<void>;
    openFriendProfileInMainWindow: (userId: string) => Promise<void>;
    openAddFriendModalInMainWindow: () => Promise<void>;
    onOpenAddFriendModal: (cb: () => void) => () => Electron.IpcRenderer;
    onFriendsUpdated: (cb: () => void) => () => Electron.IpcRenderer;
    onFriendPresence: (
      cb: (presence: FriendPresenceSync) => void
    ) => () => Electron.IpcRenderer;
    onProfileUpdated: (cb: () => void) => () => Electron.IpcRenderer;
    onNavigate: (cb: (path: string) => void) => () => Electron.IpcRenderer;

    /* Download Options */
    onNewDownloadOptions: (
      cb: (gamesWithNewOptions: { gameId: string; count: number }[]) => void
    ) => () => Electron.IpcRenderer;

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

    /* Transfer Game */
    getAvailableDrives: () => Promise<DriveInfo[]>;
    transferGameFiles: (
      shop: GameShop,
      objectId: string,
      destParent: string
    ) => Promise<{
      ok: boolean;
      error?: string;
      needed?: number;
      available?: number;
      newExePath?: string;
    }>;

    // Cancel for game transfers
    cancelGameTransfer: (shop: GameShop, objectId: string) => Promise<void>;

    /* Event listeners for transfer progress */
    on: (channel: string, listener: (...args: any[]) => void) => void;
    off: (channel: string, listener: (...args: any[]) => void) => void;
  }

  interface Window {
    electron: Electron;
  }
}
