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
} from "@types";
import type { CatalogueCategory } from "@shared";
import type { AxiosProgressEvent } from "axios";
import { GameAchievement } from "@main/entity";

contextBridge.exposeInMainWorld("electron", {
  /* Torrenting */
  startGameDownload: (payload: StartGameDownloadPayload) =>
    ipcRenderer.invoke("startGameDownload", payload),
  cancelGameDownload: (gameId: number) =>
    ipcRenderer.invoke("cancelGameDownload", gameId),
  pauseGameDownload: (gameId: number) =>
    ipcRenderer.invoke("pauseGameDownload", gameId),
  resumeGameDownload: (gameId: number) =>
    ipcRenderer.invoke("resumeGameDownload", gameId),
  onDownloadProgress: (cb: (value: DownloadProgress) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: DownloadProgress
    ) => cb(value);
    ipcRenderer.on("on-download-progress", listener);
    return () => ipcRenderer.removeListener("on-download-progress", listener);
  },

  /* Catalogue */
  searchGames: (query: string) => ipcRenderer.invoke("searchGames", query),
  getCatalogue: (category: CatalogueCategory) =>
    ipcRenderer.invoke("getCatalogue", category),
  getGameShopDetails: (objectId: string, shop: GameShop, language: string) =>
    ipcRenderer.invoke("getGameShopDetails", objectId, shop, language),
  getRandomGame: () => ipcRenderer.invoke("getRandomGame"),
  getHowLongToBeat: (title: string) =>
    ipcRenderer.invoke("getHowLongToBeat", title),
  getGames: (take?: number, skip?: number) =>
    ipcRenderer.invoke("getGames", take, skip),
  searchGameRepacks: (query: string) =>
    ipcRenderer.invoke("searchGameRepacks", query),
  getGameStats: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("getGameStats", objectId, shop),
  getTrendingGames: () => ipcRenderer.invoke("getTrendingGames"),
  getGameAchievements: (objectId: string, shop: GameShop, userId?: string) =>
    ipcRenderer.invoke("getGameAchievements", objectId, shop, userId),
  onAchievementUnlocked: (
    cb: (
      objectId: string,
      shop: GameShop,
      achievements?: { displayName: string; iconUrl: string }[]
    ) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      objectId: string,
      shop: GameShop,
      achievements?: { displayName: string; iconUrl: string }[]
    ) => cb(objectId, shop, achievements);
    ipcRenderer.on("on-achievement-unlocked", listener);
    return () =>
      ipcRenderer.removeListener("on-achievement-unlocked", listener);
  },
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
  autoLaunch: (enabled: boolean) => ipcRenderer.invoke("autoLaunch", enabled),
  authenticateRealDebrid: (apiToken: string) =>
    ipcRenderer.invoke("authenticateRealDebrid", apiToken),

  /* Download sources */
  getDownloadSources: () => ipcRenderer.invoke("getDownloadSources"),
  deleteDownloadSource: (id: number) =>
    ipcRenderer.invoke("deleteDownloadSource", id),

  /* Library */
  addGameToLibrary: (objectId: string, title: string, shop: GameShop) =>
    ipcRenderer.invoke("addGameToLibrary", objectId, title, shop),
  createGameShortcut: (id: number) =>
    ipcRenderer.invoke("createGameShortcut", id),
  updateExecutablePath: (id: number, executablePath: string) =>
    ipcRenderer.invoke("updateExecutablePath", id, executablePath),
  verifyExecutablePathInUse: (executablePath: string) =>
    ipcRenderer.invoke("verifyExecutablePathInUse", executablePath),
  getLibrary: () => ipcRenderer.invoke("getLibrary"),
  openGameInstaller: (gameId: number) =>
    ipcRenderer.invoke("openGameInstaller", gameId),
  openGameInstallerPath: (gameId: number) =>
    ipcRenderer.invoke("openGameInstallerPath", gameId),
  openGameExecutablePath: (gameId: number) =>
    ipcRenderer.invoke("openGameExecutablePath", gameId),
  openGame: (gameId: number, executablePath: string) =>
    ipcRenderer.invoke("openGame", gameId, executablePath),
  closeGame: (gameId: number) => ipcRenderer.invoke("closeGame", gameId),
  removeGameFromLibrary: (gameId: number) =>
    ipcRenderer.invoke("removeGameFromLibrary", gameId),
  removeGame: (gameId: number) => ipcRenderer.invoke("removeGame", gameId),
  deleteGameFolder: (gameId: number) =>
    ipcRenderer.invoke("deleteGameFolder", gameId),
  getGameByObjectId: (objectId: string) =>
    ipcRenderer.invoke("getGameByObjectId", objectId),
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

  /* Hardware */
  getDiskFreeSpace: (path: string) =>
    ipcRenderer.invoke("getDiskFreeSpace", path),

  /* Cloud save */
  uploadSaveGame: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("uploadSaveGame", objectId, shop),
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
  checkGameCloudSyncSupport: (objectId: string, shop: GameShop) =>
    ipcRenderer.invoke("checkGameCloudSyncSupport", objectId, shop),
  deleteGameArtifact: (gameArtifactId: string) =>
    ipcRenderer.invoke("deleteGameArtifact", gameArtifactId),
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
        `on-backup-download-complete-${objectId}-${shop}`,
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
  isPortableVersion: () => ipcRenderer.invoke("isPortableVersion"),
  openExternal: (src: string) => ipcRenderer.invoke("openExternal", src),
  showOpenDialog: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke("showOpenDialog", options),
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
  checkForUpdates: () => ipcRenderer.invoke("checkForUpdates"),
  restartAndInstallUpdate: () => ipcRenderer.invoke("restartAndInstallUpdate"),

  /* Profile */
  getMe: () => ipcRenderer.invoke("getMe"),
  undoFriendship: (userId: string) =>
    ipcRenderer.invoke("undoFriendship", userId),
  updateProfile: (updateProfile: UpdateProfileRequest) =>
    ipcRenderer.invoke("updateProfile", updateProfile),
  processProfileImage: (imagePath: string) =>
    ipcRenderer.invoke("processProfileImage", imagePath),
  getFriendRequests: () => ipcRenderer.invoke("getFriendRequests"),
  syncFriendRequests: () => ipcRenderer.invoke("syncFriendRequests"),
  updateFriendRequest: (userId: string, action: FriendRequestAction) =>
    ipcRenderer.invoke("updateFriendRequest", userId, action),
  sendFriendRequest: (userId: string) =>
    ipcRenderer.invoke("sendFriendRequest", userId),

  /* User */
  getUser: (userId: string) => ipcRenderer.invoke("getUser", userId),
  blockUser: (userId: string) => ipcRenderer.invoke("blockUser", userId),
  unblockUser: (userId: string) => ipcRenderer.invoke("unblockUser", userId),
  getUserFriends: (userId: string, take: number, skip: number) =>
    ipcRenderer.invoke("getUserFriends", userId, take, skip),
  getBlockedUsers: (take: number, skip: number) =>
    ipcRenderer.invoke("getBlockedUsers", take, skip),
  getUserStats: (userId: string) => ipcRenderer.invoke("getUserStats", userId),
  reportUser: (userId: string, reason: string, description: string) =>
    ipcRenderer.invoke("reportUser", userId, reason, description),

  /* Auth */
  signOut: () => ipcRenderer.invoke("signOut"),
  openAuthWindow: () => ipcRenderer.invoke("openAuthWindow"),
  getSessionHash: () => ipcRenderer.invoke("getSessionHash"),
  onSignIn: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-signin", listener);
    return () => ipcRenderer.removeListener("on-signin", listener);
  },
  onSignOut: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-signout", listener);
    return () => ipcRenderer.removeListener("on-signout", listener);
  },

  /* Notifications */
  publishNewRepacksNotification: (newRepacksCount: number) =>
    ipcRenderer.invoke("publishNewRepacksNotification", newRepacksCount),
});
