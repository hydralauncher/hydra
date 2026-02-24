// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from "electron";

import type {
  GameShop,
  DownloadProgress,
  UserPreferences,
  AppUpdaterEvent,
  StartGameDownloadPayload,
  GameRunning,
  FriendRequestAction,
  UpdateProfileRequest,
  SeedingStatus,
  GameAchievement,
  Theme,
  FriendRequestSync,
  NotificationSync,
  ShortcutLocation,
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
  ProtonVersion,
} from "@types";
import type { AuthPage } from "@shared";
import type { AxiosProgressEvent } from "axios";

contextBridge.exposeInMainWorld("electron", {
  /* Torrenting */
  startGameDownload: (payload: StartGameDownloadPayload) =>
    ipcRenderer.invoke("startGameDownload", payload),
  addGameToQueue: (payload: StartGameDownloadPayload) =>
    ipcRenderer.invoke("addGameToQueue", payload),
  cancelGameDownload: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("cancelGameDownload", shop, objectId),
  pauseGameDownload: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("pauseGameDownload", shop, objectId),
  resumeGameDownload: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("resumeGameDownload", shop, objectId),
  pauseGameSeed: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("pauseGameSeed", shop, objectId),
  resumeGameSeed: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("resumeGameSeed", shop, objectId),
  updateDownloadQueuePosition: (
    shop: GameShop,
    objectId: string,
    direction: "up" | "down"
  ) =>
    ipcRenderer.invoke(
      "updateDownloadQueuePosition",
      shop,
      objectId,
      direction
    ),
  onDownloadProgress: (cb: (value: DownloadProgress | null) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: DownloadProgress | null
    ) => cb(value);
    ipcRenderer.on("on-download-progress", listener);
    return () => ipcRenderer.removeListener("on-download-progress", listener);
  },
  onHardDelete: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-hard-delete", listener);
    return () => ipcRenderer.removeListener("on-hard-delete", listener);
  },
  onSeedingStatus: (cb: (value: SeedingStatus[]) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: SeedingStatus[]
    ) => cb(value);
    ipcRenderer.on("on-seeding-status", listener);
    return () => ipcRenderer.removeListener("on-seeding-status", listener);
  },
  checkDebridAvailability: (magnets: string[]) =>
    ipcRenderer.invoke("checkDebridAvailability", magnets),

  /* Catalogue */
  getGameShopDetails: (objectId: string, shop: GameShop, language: string) =>
    ipcRenderer.invoke("getGameShopDetails", objectId, shop, language),
  getRandomGame: () => ipcRenderer.invoke("getRandomGame"),
  getGameStats: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("getGameStats", objectId, shop),
  getGameAssets: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("getGameAssets", objectId, shop),
  onUpdateAchievements: (
    objectId: string,
    shop: GameShop,
    cb: (achievements: GameAchievement[]) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      achievements: GameAchievement[]
    ) => cb(achievements);
    ipcRenderer.on(`on-update-achievements-${objectId}-${shop}`, listener);
    return () =>
      ipcRenderer.removeListener(
        `on-update-achievements-${objectId}-${shop}`,
        listener
      );
  },

  /* User preferences */
  getUserPreferences: () => ipcRenderer.invoke("getUserPreferences"),
  updateUserPreferences: (preferences: UserPreferences) =>
    ipcRenderer.invoke("updateUserPreferences", preferences),
  autoLaunch: (autoLaunchProps: { enabled: boolean; minimized: boolean }) =>
    ipcRenderer.invoke("autoLaunch", autoLaunchProps),
  authenticateRealDebrid: (apiToken: string) =>
    ipcRenderer.invoke("authenticateRealDebrid", apiToken),
  authenticatePremiumize: (apiToken: string) =>
    ipcRenderer.invoke("authenticatePremiumize", apiToken),
  authenticateAllDebrid: (apiToken: string) =>
    ipcRenderer.invoke("authenticateAllDebrid", apiToken),
  authenticateTorBox: (apiToken: string) =>
    ipcRenderer.invoke("authenticateTorBox", apiToken),

  /* Download sources */
  addDownloadSource: (url: string) =>
    ipcRenderer.invoke("addDownloadSource", url),
  removeDownloadSource: (url: string, removeAll?: boolean) =>
    ipcRenderer.invoke("removeDownloadSource", url, removeAll),
  getDownloadSources: () => ipcRenderer.invoke("getDownloadSources"),
  syncDownloadSources: () => ipcRenderer.invoke("syncDownloadSources"),
  getDownloadSourcesCheckBaseline: () =>
    ipcRenderer.invoke("getDownloadSourcesCheckBaseline"),
  getDownloadSourcesSinceValue: () =>
    ipcRenderer.invoke("getDownloadSourcesSinceValue"),

  /* Library */
  toggleAutomaticCloudSync: (
    shop: GameShop,
    objectId: string,
    automaticCloudSync: boolean
  ) =>
    ipcRenderer.invoke(
      "toggleAutomaticCloudSync",
      shop,
      objectId,
      automaticCloudSync
    ),
  toggleGameMangohud: (
    shop: GameShop,
    objectId: string,
    autoRunMangohud: boolean
  ) =>
    ipcRenderer.invoke("toggleGameMangohud", shop, objectId, autoRunMangohud),
  toggleGameGamemode: (
    shop: GameShop,
    objectId: string,
    autoRunGamemode: boolean
  ) =>
    ipcRenderer.invoke("toggleGameGamemode", shop, objectId, autoRunGamemode),
  isGamemodeAvailable: () => ipcRenderer.invoke("isGamemodeAvailable"),
  isMangohudAvailable: () => ipcRenderer.invoke("isMangohudAvailable"),
  isWinetricksAvailable: () => ipcRenderer.invoke("isWinetricksAvailable"),
  addGameToLibrary: (shop: GameShop, objectId: string, title: string) =>
    ipcRenderer.invoke("addGameToLibrary", shop, objectId, title),
  addCustomGameToLibrary: (
    title: string,
    executablePath: string,
    iconUrl?: string,
    logoImageUrl?: string,
    libraryHeroImageUrl?: string
  ) =>
    ipcRenderer.invoke(
      "addCustomGameToLibrary",
      title,
      executablePath,
      iconUrl,
      logoImageUrl,
      libraryHeroImageUrl
    ),
  copyCustomGameAsset: (
    sourcePath: string,
    assetType: "icon" | "logo" | "hero"
  ) => ipcRenderer.invoke("copyCustomGameAsset", sourcePath, assetType),
  saveTempFile: (fileName: string, fileData: Uint8Array) =>
    ipcRenderer.invoke("saveTempFile", fileName, fileData),
  deleteTempFile: (filePath: string) =>
    ipcRenderer.invoke("deleteTempFile", filePath),
  cleanupUnusedAssets: () => ipcRenderer.invoke("cleanupUnusedAssets"),
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
  }) => ipcRenderer.invoke("updateCustomGame", params),
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
  }) => ipcRenderer.invoke("updateGameCustomAssets", params),
  createGameShortcut: (
    shop: GameShop,
    objectId: string,
    location: ShortcutLocation
  ) => ipcRenderer.invoke("createGameShortcut", shop, objectId, location),
  updateExecutablePath: (
    shop: GameShop,
    objectId: string,
    executablePath: string | null
  ) =>
    ipcRenderer.invoke("updateExecutablePath", shop, objectId, executablePath),
  addGameToFavorites: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("addGameToFavorites", shop, objectId),
  removeGameFromFavorites: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("removeGameFromFavorites", shop, objectId),
  assignGameToCollection: (
    shop: GameShop,
    objectId: string,
    collectionId: string | null
  ) =>
    ipcRenderer.invoke("assignGameToCollection", shop, objectId, collectionId),
  clearNewDownloadOptions: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("clearNewDownloadOptions", shop, objectId),
  toggleGamePin: (shop: GameShop, objectId: string, pinned: boolean) =>
    ipcRenderer.invoke("toggleGamePin", shop, objectId, pinned),
  updateLaunchOptions: (
    shop: GameShop,
    objectId: string,
    launchOptions: string | null
  ) => ipcRenderer.invoke("updateLaunchOptions", shop, objectId, launchOptions),

  selectGameWinePrefix: (
    shop: GameShop,
    objectId: string,
    winePrefixPath: string | null
  ) =>
    ipcRenderer.invoke("selectGameWinePrefix", shop, objectId, winePrefixPath),
  selectGameProtonPath: (
    shop: GameShop,
    objectId: string,
    protonPath: string | null
  ) => ipcRenderer.invoke("selectGameProtonPath", shop, objectId, protonPath),
  getInstalledProtonVersions: () =>
    ipcRenderer.invoke("getInstalledProtonVersions") as Promise<
      ProtonVersion[]
    >,
  getGameLaunchProtonVersion: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getGameLaunchProtonVersion", shop, objectId),
  verifyExecutablePathInUse: (executablePath: string) =>
    ipcRenderer.invoke("verifyExecutablePathInUse", executablePath),
  getLibrary: () => ipcRenderer.invoke("getLibrary"),
  refreshLibraryAssets: () => ipcRenderer.invoke("refreshLibraryAssets"),
  openGameInstaller: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("openGameInstaller", shop, objectId),
  getGameInstallerActionType: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getGameInstallerActionType", shop, objectId),
  openGameInstallerPath: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("openGameInstallerPath", shop, objectId),
  openGameWinetricks: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("openGameWinetricks", shop, objectId),
  openGameExecutablePath: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("openGameExecutablePath", shop, objectId),
  getGameSaveFolder: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getGameSaveFolder", shop, objectId),
  openGameSaveFolder: (
    shop: GameShop,
    objectId: string,
    saveFolderPath: string
  ) => ipcRenderer.invoke("openGameSaveFolder", shop, objectId, saveFolderPath),
  openGame: (
    shop: GameShop,
    objectId: string,
    executablePath: string,
    launchOptions?: string | null
  ) =>
    ipcRenderer.invoke(
      "openGame",
      shop,
      objectId,
      executablePath,
      launchOptions
    ),
  closeGame: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("closeGame", shop, objectId),
  removeGameFromLibrary: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("removeGameFromLibrary", shop, objectId),
  removeGame: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("removeGame", shop, objectId),
  deleteGameFolder: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("deleteGameFolder", shop, objectId),
  getGameByObjectId: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("getGameByObjectId", shop, objectId),
  resetGameAchievements: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("resetGameAchievements", shop, objectId),
  changeGamePlayTime: (shop: GameShop, objectId: string, playtime: number) =>
    ipcRenderer.invoke("changeGamePlayTime", shop, objectId, playtime),
  extractGameDownload: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("extractGameDownload", shop, objectId),
  scanInstalledGames: () => ipcRenderer.invoke("scanInstalledGames"),
  getDefaultWinePrefixSelectionPath: () =>
    ipcRenderer.invoke("getDefaultWinePrefixSelectionPath"),
  createSteamShortcut: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("createSteamShortcut", shop, objectId),
  onGamesRunning: (
    cb: (
      gamesRunning: Pick<GameRunning, "id" | "sessionDurationInMillis">[]
    ) => void
  ) => {
    const listener = (_event: Electron.IpcRendererEvent, gamesRunning) =>
      cb(gamesRunning);
    ipcRenderer.on("on-games-running", listener);
    return () => ipcRenderer.removeListener("on-games-running", listener);
  },
  onLibraryBatchComplete: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-library-batch-complete", listener);
    return () =>
      ipcRenderer.removeListener("on-library-batch-complete", listener);
  },
  onExtractionComplete: (cb: (shop: GameShop, objectId: string) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      shop: GameShop,
      objectId: string
    ) => cb(shop, objectId);
    ipcRenderer.on("on-extraction-complete", listener);
    return () => ipcRenderer.removeListener("on-extraction-complete", listener);
  },
  onExtractionProgress: (
    cb: (shop: GameShop, objectId: string, progress: number) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      shop: GameShop,
      objectId: string,
      progress: number
    ) => cb(shop, objectId, progress);
    ipcRenderer.on("on-extraction-progress", listener);
    return () => ipcRenderer.removeListener("on-extraction-progress", listener);
  },
  onExtractionFailed: (cb: (shop: GameShop, objectId: string) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      shop: GameShop,
      objectId: string
    ) => cb(shop, objectId);
    ipcRenderer.on("on-extraction-failed", listener);
    return () => ipcRenderer.removeListener("on-extraction-failed", listener);
  },
  onArchiveDeletionPrompt: (cb: (archivePaths: string[]) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      archivePaths: string[]
    ) => cb(archivePaths);
    ipcRenderer.on("on-archive-deletion-prompt", listener);
    return () =>
      ipcRenderer.removeListener("on-archive-deletion-prompt", listener);
  },
  deleteArchive: (filePath: string) =>
    ipcRenderer.invoke("deleteArchive", filePath),

  /* Hardware */
  getDiskFreeSpace: (path: string) =>
    ipcRenderer.invoke("getDiskFreeSpace", path),
  checkFolderWritePermission: (path: string) =>
    ipcRenderer.invoke("checkFolderWritePermission", path),

  /* Cloud save */
  uploadSaveGame: (
    objectId: string,
    shop: GameShop,
    downloadOptionTitle: string | null
  ) =>
    ipcRenderer.invoke("uploadSaveGame", objectId, shop, downloadOptionTitle),
  downloadGameArtifact: (
    objectId: string,
    shop: GameShop,
    gameArtifactId: string
  ) =>
    ipcRenderer.invoke("downloadGameArtifact", objectId, shop, gameArtifactId),
  getGameArtifacts: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("getGameArtifacts", objectId, shop),
  getGameBackupPreview: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("getGameBackupPreview", objectId, shop),
  selectGameBackupPath: (
    shop: GameShop,
    objectId: string,
    backupPath: string | null
  ) => ipcRenderer.invoke("selectGameBackupPath", shop, objectId, backupPath),
  onUploadComplete: (objectId: string, shop: GameShop, cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on(`on-upload-complete-${objectId}-${shop}`, listener);
    return () =>
      ipcRenderer.removeListener(
        `on-upload-complete-${objectId}-${shop}`,
        listener
      );
  },
  onBackupDownloadProgress: (
    objectId: string,
    shop: GameShop,
    cb: (progress: AxiosProgressEvent) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: AxiosProgressEvent
    ) => cb(progress);
    ipcRenderer.on(`on-backup-download-progress-${objectId}-${shop}`, listener);
    return () =>
      ipcRenderer.removeListener(
        `on-backup-download-progress-${objectId}-${shop}`,
        listener
      );
  },
  onBackupDownloadComplete: (
    objectId: string,
    shop: GameShop,
    cb: () => void
  ) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on(`on-backup-download-complete-${objectId}-${shop}`, listener);
    return () =>
      ipcRenderer.removeListener(
        `on-backup-download-complete-${objectId}-${shop}`,
        listener
      );
  },

  /* Misc */
  ping: () => ipcRenderer.invoke("ping"),
  getVersion: () => ipcRenderer.invoke("getVersion"),
  getDefaultDownloadsPath: () => ipcRenderer.invoke("getDefaultDownloadsPath"),
  isStaging: () => ipcRenderer.invoke("isStaging"),
  isPortableVersion: () => ipcRenderer.invoke("isPortableVersion"),
  openExternal: (src: string) => ipcRenderer.invoke("openExternal", src),
  openCheckout: () => ipcRenderer.invoke("openCheckout"),
  showOpenDialog: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke("showOpenDialog", options),
  showItemInFolder: (path: string) =>
    ipcRenderer.invoke("showItemInFolder", path),
  getImageDataUrl: (imageUrl: string) =>
    ipcRenderer.invoke("getImageDataUrl", imageUrl),
  hydraApi: {
    get: (
      url: string,
      options?: {
        params?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
        ifModifiedSince?: Date;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "get",
        url,
        params: options?.params,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
          ifModifiedSince: options?.ifModifiedSince,
        },
      }),
    post: (
      url: string,
      options?: {
        data?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "post",
        url,
        data: options?.data,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
        },
      }),
    put: (
      url: string,
      options?: {
        data?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "put",
        url,
        data: options?.data,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
        },
      }),
    patch: (
      url: string,
      options?: {
        data?: unknown;
        needsAuth?: boolean;
        needsSubscription?: boolean;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "patch",
        url,
        data: options?.data,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
        },
      }),
    delete: (
      url: string,
      options?: {
        needsAuth?: boolean;
        needsSubscription?: boolean;
      }
    ) =>
      ipcRenderer.invoke("hydraApiCall", {
        method: "delete",
        url,
        options: {
          needsAuth: options?.needsAuth,
          needsSubscription: options?.needsSubscription,
        },
      }),
  },
  canInstallCommonRedist: () => ipcRenderer.invoke("canInstallCommonRedist"),
  installCommonRedist: () => ipcRenderer.invoke("installCommonRedist"),
  installHydraDeckyPlugin: () => ipcRenderer.invoke("installHydraDeckyPlugin"),
  getHydraDeckyPluginInfo: () => ipcRenderer.invoke("getHydraDeckyPluginInfo"),
  checkHomebrewFolderExists: () =>
    ipcRenderer.invoke("checkHomebrewFolderExists"),
  platform: process.platform,

  /* Auto update */
  onAutoUpdaterEvent: (cb: (value: AppUpdaterEvent) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: AppUpdaterEvent
    ) => cb(value);

    ipcRenderer.on("autoUpdaterEvent", listener);

    return () => {
      ipcRenderer.removeListener("autoUpdaterEvent", listener);
    };
  },
  onCommonRedistProgress: (
    cb: (value: { log: string; complete: boolean }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: { log: string; complete: boolean }
    ) => cb(value);
    ipcRenderer.on("common-redist-progress", listener);
    return () => ipcRenderer.removeListener("common-redist-progress", listener);
  },
  onPreflightProgress: (
    cb: (value: { status: string; detail: string | null }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: { status: string; detail: string | null }
    ) => cb(value);
    ipcRenderer.on("preflight-progress", listener);
    return () => ipcRenderer.removeListener("preflight-progress", listener);
  },
  resetCommonRedistPreflight: () =>
    ipcRenderer.invoke("resetCommonRedistPreflight"),
  checkForUpdates: () => ipcRenderer.invoke("checkForUpdates"),
  restartAndInstallUpdate: () => ipcRenderer.invoke("restartAndInstallUpdate"),

  /* Profile */
  getMe: () => ipcRenderer.invoke("getMe"),
  updateProfile: (updateProfile: UpdateProfileRequest) =>
    ipcRenderer.invoke("updateProfile", updateProfile),
  processProfileImage: (imagePath: string) =>
    ipcRenderer.invoke("processProfileImage", imagePath),
  onSyncFriendRequests: (cb: (friendRequests: FriendRequestSync) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      friendRequests: FriendRequestSync
    ) => cb(friendRequests);
    ipcRenderer.on("on-sync-friend-requests", listener);
    return () =>
      ipcRenderer.removeListener("on-sync-friend-requests", listener);
  },
  onSyncNotificationCount: (cb: (notification: NotificationSync) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      notification: NotificationSync
    ) => cb(notification);
    ipcRenderer.on("on-sync-notification-count", listener);
    return () =>
      ipcRenderer.removeListener("on-sync-notification-count", listener);
  },
  updateFriendRequest: (userId: string, action: FriendRequestAction) =>
    ipcRenderer.invoke("updateFriendRequest", userId, action),

  /* User */
  getComparedUnlockedAchievements: (
    objectId: string,
    shop: GameShop,
    userId: string
  ) =>
    ipcRenderer.invoke(
      "getComparedUnlockedAchievements",
      objectId,
      shop,
      userId
    ),
  getUnlockedAchievements: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("getUnlockedAchievements", objectId, shop),

  /* Auth */
  getAuth: () => ipcRenderer.invoke("getAuth"),
  signOut: () => ipcRenderer.invoke("signOut"),
  openAuthWindow: (page: AuthPage) =>
    ipcRenderer.invoke("openAuthWindow", page),
  getSessionHash: () => ipcRenderer.invoke("getSessionHash"),
  onSignIn: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-signin", listener);
    return () => ipcRenderer.removeListener("on-signin", listener);
  },
  onAccountUpdated: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-account-updated", listener);
    return () => ipcRenderer.removeListener("on-account-updated", listener);
  },
  onSignOut: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-signout", listener);
    return () => ipcRenderer.removeListener("on-signout", listener);
  },

  /* Notifications */
  publishNewRepacksNotification: (newRepacksCount: number) =>
    ipcRenderer.invoke("publishNewRepacksNotification", newRepacksCount),
  getLocalNotifications: () => ipcRenderer.invoke("getLocalNotifications"),
  getLocalNotificationsCount: () =>
    ipcRenderer.invoke("getLocalNotificationsCount"),
  markLocalNotificationRead: (id: string) =>
    ipcRenderer.invoke("markLocalNotificationRead", id),
  markAllLocalNotificationsRead: () =>
    ipcRenderer.invoke("markAllLocalNotificationsRead"),
  deleteLocalNotification: (id: string) =>
    ipcRenderer.invoke("deleteLocalNotification", id),
  clearAllLocalNotifications: () =>
    ipcRenderer.invoke("clearAllLocalNotifications"),
  onLocalNotificationCreated: (cb: (notification: unknown) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      notification: unknown
    ) => cb(notification);
    ipcRenderer.on("on-local-notification-created", listener);
    return () =>
      ipcRenderer.removeListener("on-local-notification-created", listener);
  },
  onAchievementUnlocked: (
    cb: (
      position?: AchievementCustomNotificationPosition,
      achievements?: AchievementNotificationInfo[]
    ) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      position?: AchievementCustomNotificationPosition,
      achievements?: AchievementNotificationInfo[]
    ) => cb(position, achievements);
    ipcRenderer.on("on-achievement-unlocked", listener);
    return () =>
      ipcRenderer.removeListener("on-achievement-unlocked", listener);
  },
  onCombinedAchievementsUnlocked: (
    cb: (
      gameCount: number,
      achievementsCount: number,
      position: AchievementCustomNotificationPosition
    ) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      gameCount: number,
      achievementCount: number,
      position: AchievementCustomNotificationPosition
    ) => cb(gameCount, achievementCount, position);
    ipcRenderer.on("on-combined-achievements-unlocked", listener);
    return () =>
      ipcRenderer.removeListener("on-combined-achievements-unlocked", listener);
  },
  updateAchievementCustomNotificationWindow: () =>
    ipcRenderer.invoke("updateAchievementCustomNotificationWindow"),
  showAchievementTestNotification: () =>
    ipcRenderer.invoke("showAchievementTestNotification"),

  /* Themes */
  addCustomTheme: (theme: Theme) => ipcRenderer.invoke("addCustomTheme", theme),
  getAllCustomThemes: () => ipcRenderer.invoke("getAllCustomThemes"),
  deleteAllCustomThemes: () => ipcRenderer.invoke("deleteAllCustomThemes"),
  deleteCustomTheme: (themeId: string) =>
    ipcRenderer.invoke("deleteCustomTheme", themeId),
  updateCustomTheme: (themeId: string, code: string) =>
    ipcRenderer.invoke("updateCustomTheme", themeId, code),
  getCustomThemeById: (themeId: string) =>
    ipcRenderer.invoke("getCustomThemeById", themeId),
  getActiveCustomTheme: () => ipcRenderer.invoke("getActiveCustomTheme"),
  toggleCustomTheme: (themeId: string, isActive: boolean) =>
    ipcRenderer.invoke("toggleCustomTheme", themeId, isActive),
  copyThemeAchievementSound: (themeId: string, sourcePath: string) =>
    ipcRenderer.invoke("copyThemeAchievementSound", themeId, sourcePath),
  removeThemeAchievementSound: (themeId: string) =>
    ipcRenderer.invoke("removeThemeAchievementSound", themeId),
  getThemeSoundPath: (themeId: string) =>
    ipcRenderer.invoke("getThemeSoundPath", themeId),
  getThemeSoundDataUrl: (themeId: string) =>
    ipcRenderer.invoke("getThemeSoundDataUrl", themeId),
  importThemeSoundFromStore: (
    themeId: string,
    themeName: string,
    storeUrl: string
  ) =>
    ipcRenderer.invoke(
      "importThemeSoundFromStore",
      themeId,
      themeName,
      storeUrl
    ),

  /* Editor */
  openEditorWindow: (themeId: string) =>
    ipcRenderer.invoke("openEditorWindow", themeId),
  onCustomThemeUpdated: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-custom-theme-updated", listener);
    return () =>
      ipcRenderer.removeListener("on-custom-theme-updated", listener);
  },
  onNewDownloadOptions: (
    cb: (gamesWithNewOptions: { gameId: string; count: number }[]) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      gamesWithNewOptions: { gameId: string; count: number }[]
    ) => cb(gamesWithNewOptions);
    ipcRenderer.on("on-new-download-options", listener);
    return () =>
      ipcRenderer.removeListener("on-new-download-options", listener);
  },
  closeEditorWindow: (themeId?: string) =>
    ipcRenderer.invoke("closeEditorWindow", themeId),

  /* Game Launcher Window */
  showGameLauncherWindow: () => ipcRenderer.invoke("showGameLauncherWindow"),
  closeGameLauncherWindow: () => ipcRenderer.invoke("closeGameLauncherWindow"),
  openMainWindow: () => ipcRenderer.invoke("openMainWindow"),
  isMainWindowOpen: () => ipcRenderer.invoke("isMainWindowOpen"),

  /* LevelDB Generic CRUD */
  leveldb: {
    get: (
      key: string,
      sublevelName?: string | null,
      valueEncoding?: "json" | "utf8"
    ) => ipcRenderer.invoke("leveldbGet", key, sublevelName, valueEncoding),
    put: (
      key: string,
      value: unknown,
      sublevelName?: string | null,
      valueEncoding?: "json" | "utf8"
    ) =>
      ipcRenderer.invoke("leveldbPut", key, value, sublevelName, valueEncoding),
    del: (key: string, sublevelName?: string | null) =>
      ipcRenderer.invoke("leveldbDel", key, sublevelName),
    clear: (sublevelName: string) =>
      ipcRenderer.invoke("leveldbClear", sublevelName),
    values: (sublevelName: string) =>
      ipcRenderer.invoke("leveldbValues", sublevelName),
    iterator: (sublevelName: string) =>
      ipcRenderer.invoke("leveldbIterator", sublevelName),
  },
});
