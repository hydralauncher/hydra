// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from "electron";

import type {
  CatalogueCategory,
  GameShop,
  TorrentProgress,
  UserPreferences,
} from "@types";

contextBridge.exposeInMainWorld("electron", {
  /* Torrenting */
  startGameDownload: (
    repackId: number,
    objectID: string,
    title: string,
    shop: GameShop
  ) => ipcRenderer.invoke("startGameDownload", repackId, objectID, title, shop),
  cancelGameDownload: (gameId: number) =>
    ipcRenderer.invoke("cancelGameDownload", gameId),
  pauseGameDownload: (gameId: number) =>
    ipcRenderer.invoke("pauseGameDownload", gameId),
  resumeGameDownload: (gameId: number) =>
    ipcRenderer.invoke("resumeGameDownload", gameId),
  onDownloadProgress: (cb: (value: TorrentProgress) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: TorrentProgress
    ) => cb(value);
    ipcRenderer.on("on-download-progress", listener);
    return () => ipcRenderer.removeListener("on-download-progress", listener);
  },

  /* Catalogue */
  searchGames: (query: string) => ipcRenderer.invoke("searchGames", query),
  getCatalogue: (category: CatalogueCategory) =>
    ipcRenderer.invoke("getCatalogue", category),
  getGameShopDetails: (objectID: string, shop: GameShop, language: string) =>
    ipcRenderer.invoke("getGameShopDetails", objectID, shop, language),
  getRandomGame: () => ipcRenderer.invoke("getRandomGame"),
  getHowLongToBeat: (objectID: string, shop: GameShop, title: string) =>
    ipcRenderer.invoke("getHowLongToBeat", objectID, shop, title),
  getGames: (take?: number, prevCursor?: number) =>
    ipcRenderer.invoke("getGames", take, prevCursor),

  /* User preferences */
  getUserPreferences: () => ipcRenderer.invoke("getUserPreferences"),
  updateUserPreferences: (preferences: UserPreferences) =>
    ipcRenderer.invoke("updateUserPreferences", preferences),

  /* Library */
  addGameToLibrary: (
    objectID: string,
    title: string,
    shop: GameShop,
    executablePath: string
  ) =>
    ipcRenderer.invoke(
      "addGameToLibrary",
      objectID,
      title,
      shop,
      executablePath
    ),
  getLibrary: () => ipcRenderer.invoke("getLibrary"),
  getRepackersFriendlyNames: () =>
    ipcRenderer.invoke("getRepackersFriendlyNames"),
  openGameInstaller: (gameId: number) =>
    ipcRenderer.invoke("openGameInstaller", gameId),
  openGame: (gameId: number, executablePath: string) =>
    ipcRenderer.invoke("openGame", gameId, executablePath),
  closeGame: (gameId: number) => ipcRenderer.invoke("closeGame", gameId),
  removeGameFromLibrary: (gameId: number) =>
    ipcRenderer.invoke("removeGameFromLibrary", gameId),
  deleteGameFolder: (gameId: number) =>
    ipcRenderer.invoke("deleteGameFolder", gameId),
  getGameByObjectID: (objectID: string) =>
    ipcRenderer.invoke("getGameByObjectID", objectID),
  onPlaytime: (cb: (gameId: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, gameId: number) =>
      cb(gameId);
    ipcRenderer.on("on-playtime", listener);
    return () => ipcRenderer.removeListener("on-playtime", listener);
  },
  onGameClose: (cb: (gameId: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, gameId: number) =>
      cb(gameId);
    ipcRenderer.on("on-game-close", listener);
    return () => ipcRenderer.removeListener("on-game-close", listener);
  },

  /* Hardware */
  getDiskFreeSpace: () => ipcRenderer.invoke("getDiskFreeSpace"),

  /* Misc */
  getOrCacheImage: (url: string) => ipcRenderer.invoke("getOrCacheImage", url),
  ping: () => ipcRenderer.invoke("ping"),
  getVersion: () => ipcRenderer.invoke("getVersion"),
  getDefaultDownloadsPath: () => ipcRenderer.invoke("getDefaultDownloadsPath"),
  openExternal: (src: string) => ipcRenderer.invoke("openExternal", src),
  showOpenDialog: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke("showOpenDialog", options),
  platform: process.platform,
});
