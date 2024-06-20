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
} from "@types";

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
  getCatalogue: () => ipcRenderer.invoke("getCatalogue"),
  getGameShopDetails: (objectID: string, shop: GameShop, language: string) =>
    ipcRenderer.invoke("getGameShopDetails", objectID, shop, language),
  getRandomGame: () => ipcRenderer.invoke("getRandomGame"),
  getHowLongToBeat: (objectID: string, shop: GameShop, title: string) =>
    ipcRenderer.invoke("getHowLongToBeat", objectID, shop, title),
  getGames: (take?: number, prevCursor?: number) =>
    ipcRenderer.invoke("getGames", take, prevCursor),
  searchGameRepacks: (query: string) =>
    ipcRenderer.invoke("searchGameRepacks", query),

  /* User preferences */
  getUserPreferences: () => ipcRenderer.invoke("getUserPreferences"),
  updateUserPreferences: (preferences: UserPreferences) =>
    ipcRenderer.invoke("updateUserPreferences", preferences),
  autoLaunch: (enabled: boolean) => ipcRenderer.invoke("autoLaunch", enabled),
  authenticateRealDebrid: (apiToken: string) =>
    ipcRenderer.invoke("authenticateRealDebrid", apiToken),

  /* Download sources */
  getDownloadSources: () => ipcRenderer.invoke("getDownloadSources"),
  validateDownloadSource: (url: string) =>
    ipcRenderer.invoke("validateDownloadSource", url),
  addDownloadSource: (url: string) =>
    ipcRenderer.invoke("addDownloadSource", url),
  removeDownloadSource: (id: number) =>
    ipcRenderer.invoke("removeDownloadSource", id),
  syncDownloadSources: () => ipcRenderer.invoke("syncDownloadSources"),

  /* Library */
  addGameToLibrary: (objectID: string, title: string, shop: GameShop) =>
    ipcRenderer.invoke("addGameToLibrary", objectID, title, shop),
  createGameShortcut: (id: number) =>
    ipcRenderer.invoke("createGameShortcut", id),
  updateExecutablePath: (id: number, executablePath: string) =>
    ipcRenderer.invoke("updateExecutablePath", id, executablePath),
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
  getGameByObjectID: (objectID: string) =>
    ipcRenderer.invoke("getGameByObjectID", objectID),
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

  /* Misc */
  ping: () => ipcRenderer.invoke("ping"),
  getVersion: () => ipcRenderer.invoke("getVersion"),
  getDefaultDownloadsPath: () => ipcRenderer.invoke("getDefaultDownloadsPath"),
  openExternal: (src: string) => ipcRenderer.invoke("openExternal", src),
  isUserLoggedIn: () => ipcRenderer.invoke("isUserLoggedIn"),
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
  updateProfile: (displayName: string, newProfileImagePath: string | null) =>
    ipcRenderer.invoke("updateProfile", displayName, newProfileImagePath),

  /* User */
  getUser: (userId: string) => ipcRenderer.invoke("getUser", userId),

  /* Auth */
  signOut: () => ipcRenderer.invoke("signOut"),
  openAuthWindow: () => ipcRenderer.invoke("openAuthWindow"),
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
});
