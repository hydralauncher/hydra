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
  UpdateProfileRequest,
  SeedingStatus,
  GameAchievement,
  Theme,
  FriendRequestSync,
  FriendPresenceSync,
  NotificationSync,
  ShortcutLocation,
  CreateSteamShortcutOptions,
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
  ProtonVersion,
  TorrentFilesResponse,
  DownloadLayoutState,
  EmulatorSystem,
  Ps2MemcardScanInput,
  Ps2MemcardScanProgress,
  Ps2MemoryCardSaveRecord,
  Ps2ExportResult,
  EmulationCloudSave,
  EmulationSavePlatform,
  MemcardRestoreResult,
  MemcardRestoreTarget,
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
  resumeGameDownload: (
    shop: GameShop,
    objectId: string,
    strategy?: "interruptActive" | "queueIfActive"
  ) => ipcRenderer.invoke("resumeGameDownload", shop, objectId, strategy),
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
  setDownloadQueuePosition: (
    shop: GameShop,
    objectId: string,
    targetIndex: number
  ) =>
    ipcRenderer.invoke("setDownloadQueuePosition", shop, objectId, targetIndex),
  setPausedDownloadPosition: (
    shop: GameShop,
    objectId: string,
    targetIndex: number
  ) =>
    ipcRenderer.invoke(
      "setPausedDownloadPosition",
      shop,
      objectId,
      targetIndex
    ),
  moveDownloadPlacement: (
    shop: GameShop,
    objectId: string,
    targetArea: "hero" | "queue" | "paused",
    targetIndex?: number
  ) =>
    ipcRenderer.invoke(
      "moveDownloadPlacement",
      shop,
      objectId,
      targetArea,
      targetIndex
    ),
  getDownloadLayoutState: () =>
    ipcRenderer.invoke(
      "getDownloadLayoutState"
    ) as Promise<DownloadLayoutState>,
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
  getTorrentFiles: (magnet: string) =>
    ipcRenderer.invoke("getTorrentFiles", magnet) as Promise<
      { ok: true; data: TorrentFilesResponse } | { ok: false; error: string }
    >,

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

  /* Emulators */
  getEmulatorConfigs: () => ipcRenderer.invoke("getEmulatorConfigs"),
  detectEmulators: () => ipcRenderer.invoke("detectEmulators"),
  detectEmulator: (system: EmulatorSystem) =>
    ipcRenderer.invoke("detectEmulator", system),
  previewEmulatorExecutable: (
    system: EmulatorSystem,
    executablePath?: string | null
  ) => ipcRenderer.invoke("previewEmulatorExecutable", system, executablePath),
  setEmulatorExecutablePath: (
    system: EmulatorSystem,
    executablePath: string | null
  ) => ipcRenderer.invoke("setEmulatorExecutablePath", system, executablePath),
  addRomFolder: (
    system: EmulatorSystem,
    folderPath: string,
    scanSubfolders: boolean,
    language?: string
  ) =>
    ipcRenderer.invoke(
      "addRomFolder",
      system,
      folderPath,
      scanSubfolders,
      language
    ),
  removeRomFolder: (system: EmulatorSystem, folderId: string) =>
    ipcRenderer.invoke("removeRomFolder", system, folderId),
  toggleRomFolderSubfolders: (
    system: EmulatorSystem,
    folderId: string,
    scanSubfolders: boolean
  ) =>
    ipcRenderer.invoke(
      "toggleRomFolderSubfolders",
      system,
      folderId,
      scanSubfolders
    ),
  rescanEmulator: (system: EmulatorSystem, language?: string) =>
    ipcRenderer.invoke("rescanEmulator", system, language),
  checkPs3Firmware: (executablePath: string | null) =>
    ipcRenderer.invoke("checkPs3Firmware", executablePath),
  startRomScan: (
    system: EmulatorSystem,
    folderPath: string,
    scanSubfolders: boolean
  ) => ipcRenderer.invoke("startRomScan", system, folderPath, scanSubfolders),
  cancelRomScan: (requestId: string) =>
    ipcRenderer.invoke("cancelRomScan", requestId),
  getEmulatorRomPaths: (system: EmulatorSystem) =>
    ipcRenderer.invoke("getEmulatorRomPaths", system),
  addEmulatorRomPath: (system: EmulatorSystem, folderPath: string) =>
    ipcRenderer.invoke("addEmulatorRomPath", system, folderPath),
  getRpcs3DefaultSources: () => ipcRenderer.invoke("getRpcs3DefaultSources"),
  removeEmulator: (system: EmulatorSystem) =>
    ipcRenderer.invoke("removeEmulator", system),
  checkEmulatorExecutable: (system: EmulatorSystem) =>
    ipcRenderer.invoke("checkEmulatorExecutable", system),
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
  ) => {
    const channel = `on-rom-scan-progress-${requestId}`;
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      cb(payload as Parameters<typeof cb>[0]);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  importLaunchboxRoms: (
    system: EmulatorSystem,
    folders: { path: string; scanSubfolders: boolean }[],
    language: string
  ) => ipcRenderer.invoke("importLaunchboxRoms", system, folders, language),
  cancelLaunchboxImport: (requestId: string) =>
    ipcRenderer.invoke("cancelLaunchboxImport", requestId),
  scanPs2Memcards: (input: Ps2MemcardScanInput) =>
    ipcRenderer.invoke("scanPs2Memcards", input),
  cancelPs2MemcardScan: (requestId: string) =>
    ipcRenderer.invoke("cancelPs2MemcardScan", requestId),
  onPs2MemcardScanProgress: (
    requestId: string,
    cb: (payload: Ps2MemcardScanProgress) => void
  ) => {
    const channel = `on-ps2-memcard-scan-progress-${requestId}`;
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      cb(payload as Ps2MemcardScanProgress);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  listPs2MemcardSaves: (): Promise<Ps2MemoryCardSaveRecord[]> =>
    ipcRenderer.invoke("listPs2MemcardSaves"),
  forgetPs2MemcardSave: (cardFilePath: string, folderName: string) =>
    ipcRenderer.invoke("forgetPs2MemcardSave", cardFilePath, folderName),
  forgetPs2MemcardCard: (cardFilePath: string) =>
    ipcRenderer.invoke("forgetPs2MemcardCard", cardFilePath),
  exportPs2Save: (
    cardFilePath: string,
    folderName: string,
    suggestedName: string
  ): Promise<Ps2ExportResult> =>
    ipcRenderer.invoke(
      "exportPs2Save",
      cardFilePath,
      folderName,
      suggestedName
    ),
  scanPs1Memcards: (input: Ps2MemcardScanInput) =>
    ipcRenderer.invoke("scanPs1Memcards", input),
  cancelPs1MemcardScan: (requestId: string) =>
    ipcRenderer.invoke("cancelPs1MemcardScan", requestId),
  onPs1MemcardScanProgress: (
    requestId: string,
    cb: (payload: Ps2MemcardScanProgress) => void
  ) => {
    const channel = `on-ps1-memcard-scan-progress-${requestId}`;
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      cb(payload as Ps2MemcardScanProgress);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  listPs1MemcardSaves: (): Promise<Ps2MemoryCardSaveRecord[]> =>
    ipcRenderer.invoke("listPs1MemcardSaves"),
  forgetPs1MemcardSave: (cardFilePath: string, identifier: string) =>
    ipcRenderer.invoke("forgetPs1MemcardSave", cardFilePath, identifier),
  forgetPs1MemcardCard: (cardFilePath: string) =>
    ipcRenderer.invoke("forgetPs1MemcardCard", cardFilePath),
  exportPs1Save: (
    cardFilePath: string,
    identifier: string,
    suggestedName: string
  ): Promise<Ps2ExportResult> =>
    ipcRenderer.invoke(
      "exportPs1Save",
      cardFilePath,
      identifier,
      suggestedName
    ),
  uploadEmulationSave: (
    platform: EmulationSavePlatform,
    cardFilePath: string,
    folderName: string
  ): Promise<EmulationCloudSave> =>
    ipcRenderer.invoke(
      "uploadEmulationSave",
      platform,
      cardFilePath,
      folderName
    ),
  uploadEmulationSavesForCard: (
    platform: EmulationSavePlatform,
    cardFilePath: string
  ): Promise<{ uploaded: number; total: number }> =>
    ipcRenderer.invoke("uploadEmulationSavesForCard", platform, cardFilePath),
  listEmulationSaves: (
    platform: EmulationSavePlatform,
    objectId?: string | null
  ): Promise<EmulationCloudSave[]> =>
    ipcRenderer.invoke("listEmulationSaves", platform, objectId),
  getMemcardRestoreTargets: (
    platform: EmulationSavePlatform
  ): Promise<MemcardRestoreTarget[]> =>
    ipcRenderer.invoke("getMemcardRestoreTargets", platform),
  restoreEmulationSave: (
    platform: EmulationSavePlatform,
    saveId: string,
    targetCardFilePath: string
  ): Promise<MemcardRestoreResult> =>
    ipcRenderer.invoke(
      "restoreEmulationSave",
      platform,
      saveId,
      targetCardFilePath
    ),
  deleteEmulationSave: (saveId: string): Promise<void> =>
    ipcRenderer.invoke("deleteEmulationSave", saveId),
  updateEmulationSaveLabel: (
    saveId: string,
    label: string
  ): Promise<EmulationCloudSave> =>
    ipcRenderer.invoke("updateEmulationSaveLabel", saveId, label),
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
  ) => {
    const channel = `on-launchbox-import-progress-${requestId}`;
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      cb(payload as Parameters<typeof cb>[0]);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  /* User preferences */
  getUserPreferences: () => ipcRenderer.invoke("getUserPreferences"),
  updateUserPreferences: (preferences: Partial<UserPreferences>) =>
    ipcRenderer.invoke("updateUserPreferences", preferences),
  onUserPreferencesUpdated: (
    cb: (preferences: UserPreferences | null) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      preferences: UserPreferences | null
    ) => cb(preferences);
    ipcRenderer.on("on-user-preferences-updated", listener);
    return () =>
      ipcRenderer.removeListener("on-user-preferences-updated", listener);
  },
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
  addGameToLibrary: (
    shop: GameShop,
    objectId: string,
    title: string,
    platform?: string | null
  ) => ipcRenderer.invoke("addGameToLibrary", shop, objectId, title, platform),
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
    collectionIds: string[]
  ) =>
    ipcRenderer.invoke("assignGameToCollection", shop, objectId, collectionIds),
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
  getClassicsImportStatus: (): Promise<boolean> =>
    ipcRenderer.invoke("getClassicsImportStatus"),
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
  openClassicsGame: (
    shop: GameShop,
    objectId: string,
    discPath?: string,
    force?: boolean
  ) => ipcRenderer.invoke("openClassicsGame", shop, objectId, discPath, force),
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
  ) => ipcRenderer.invoke("updateClassicsDisc", shop, objectId, patch),
  getEmulatorRomExtensions: (system: "ps1" | "ps2" | "ps3") =>
    ipcRenderer.invoke("getEmulatorRomExtensions", system),
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
  scanInstalledGames: (
    additionalDirectories?: string[],
    includeDefaultDirectories?: boolean
  ) =>
    ipcRenderer.invoke(
      "scanInstalledGames",
      additionalDirectories,
      includeDefaultDirectories
    ),
  getDefaultWinePrefixSelectionPath: () =>
    ipcRenderer.invoke("getDefaultWinePrefixSelectionPath"),
  createSteamShortcut: (
    shop: GameShop,
    objectId: string,
    options?: CreateSteamShortcutOptions
  ) => ipcRenderer.invoke("createSteamShortcut", shop, objectId, options),
  deleteSteamShortcut: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("deleteSteamShortcut", shop, objectId),
  checkSteamShortcut: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("checkSteamShortcut", shop, objectId),
  getGamesRunning: () => ipcRenderer.invoke("getGamesRunning"),
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
  onDownloadsUpdated: (cb: () => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => cb();
    ipcRenderer.on("on-downloads-updated", listener);
    return () => ipcRenderer.removeListener("on-downloads-updated", listener);
  },
  onClassicsImportStatus: (cb: (importing: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, importing: boolean) =>
      cb(importing);
    ipcRenderer.on("on-classics-import-status", listener);
    return () =>
      ipcRenderer.removeListener("on-classics-import-status", listener);
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

  /* Clipboard (renderer-side `navigator.clipboard.*` is deprecated in Electron 40+;
     direct `electron.clipboard` access from preload is also deprecated, so go through main via IPC) */
  clipboard: {
    writeText: (text: string) =>
      ipcRenderer.invoke("clipboardWriteText", text) as Promise<void>,
  },

  /* Misc */
  ping: () => ipcRenderer.invoke("ping"),
  getVersion: () => ipcRenderer.invoke("getVersion"),
  getDefaultDownloadsPath: () => ipcRenderer.invoke("getDefaultDownloadsPath"),
  isStaging: () => ipcRenderer.invoke("isStaging"),
  isPortableVersion: () => ipcRenderer.invoke("isPortableVersion"),
  openExternal: (src: string) => ipcRenderer.invoke("openExternal", src),
  openCheckout: () => ipcRenderer.invoke("openCheckout"),
  getCloudIframeUrl: () => ipcRenderer.invoke("getCloudIframeUrl"),
  showOpenDialog: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke("showOpenDialog", options),
  showItemInFolder: (path: string) =>
    ipcRenderer.invoke("showItemInFolder", path),
  getImageDataUrl: (imageUrl: string) =>
    ipcRenderer.invoke("getImageDataUrl", imageUrl),
  getProcessedFriendImage: (
    imageUrl: string | null,
    options: { width: number; height: number; preserveAnimation?: boolean }
  ) => ipcRenderer.invoke("getProcessedFriendImage", imageUrl, options),
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
  getProfileImageMetadata: (imagePath: string) =>
    ipcRenderer.invoke("getProfileImageMetadata", imagePath),
  processProfileImage: (imagePath: string) =>
    ipcRenderer.invoke("processProfileImage", imagePath),
  cropProfileImage: (
    imagePath: string,
    params: {
      left: number;
      top: number;
      width: number;
      height: number;
      outputWidth: number;
      outputHeight: number;
      rotation?: number;
    }
  ) => ipcRenderer.invoke("cropProfileImage", imagePath, params),
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
  syncFriendRequests: (friendRequestCount: number) =>
    ipcRenderer.invoke("syncFriendRequests", friendRequestCount),

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
  markLocalNotificationUnread: (id: string) =>
    ipcRenderer.invoke("markLocalNotificationUnread", id),
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
  onInAppAchievementUnlocked: (
    cb: (
      position: AchievementCustomNotificationPosition,
      achievements: AchievementNotificationInfo[]
    ) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      position: AchievementCustomNotificationPosition,
      achievements: AchievementNotificationInfo[]
    ) => cb(position, achievements);
    ipcRenderer.on("on-achievement-unlocked-in-app", listener);
    return () =>
      ipcRenderer.removeListener("on-achievement-unlocked-in-app", listener);
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

  /* Big Picture */
  openBigPictureWindow: () => ipcRenderer.invoke("openBigPictureWindow"),

  /* Friends */
  openFriendsWindow: () => ipcRenderer.invoke("openFriendsWindow"),
  minimizeFriendsWindow: () => ipcRenderer.invoke("minimizeFriendsWindow"),
  closeFriendsWindow: () => ipcRenderer.invoke("closeFriendsWindow"),
  openFriendProfileInMainWindow: (userId: string) =>
    ipcRenderer.invoke("openFriendProfileInMainWindow", userId),
  openAddFriendModalInMainWindow: () =>
    ipcRenderer.invoke("openAddFriendModalInMainWindow"),
  onOpenAddFriendModal: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("on-open-add-friend-modal", listener);
    return () =>
      ipcRenderer.removeListener("on-open-add-friend-modal", listener);
  },
  onFriendsUpdated: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("on-friends-updated", listener);
    return () => ipcRenderer.removeListener("on-friends-updated", listener);
  },
  onFriendPresence: (cb: (presence: FriendPresenceSync) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      presence: FriendPresenceSync
    ) => cb(presence);
    ipcRenderer.on("on-friend-presence", listener);
    return () => ipcRenderer.removeListener("on-friend-presence", listener);
  },
  onProfileUpdated: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("on-profile-updated", listener);
    return () => ipcRenderer.removeListener("on-profile-updated", listener);
  },
  onNavigate: (cb: (path: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, path: string) =>
      cb(path);
    ipcRenderer.on("on-navigate", listener);
    return () => ipcRenderer.removeListener("on-navigate", listener);
  },

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

  //UPDATEDD
  pauseGameTransfer: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("pauseGameTransfer", shop, objectId),
  resumeGameTransfer: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("resumeGameTransfer", shop, objectId),
  cancelGameTransfer: (shop: GameShop, objectId: string) =>
    ipcRenderer.invoke("cancelGameTransfer", shop, objectId),

  // Add these to the electron object in contextBridge.exposeInMainWorld
  on: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.on(channel, listener);
  },
  off: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.off(channel, listener);
  },
  getAvailableDrives: () => ipcRenderer.invoke("getAvailableDrives"),
  transferGameFiles: (shop: GameShop, objectId: string, destParent: string) =>
    ipcRenderer.invoke("transferGameFiles", shop, objectId, destParent),
});
