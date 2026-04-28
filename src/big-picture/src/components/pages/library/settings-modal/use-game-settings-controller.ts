import type {
  CreateSteamShortcutOptions,
  LibraryGame,
  ProtonVersion,
  ShortcutLocation,
  UserAchievement,
  UserDetails,
  UserPreferences,
} from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";

type FeedbackType = "success" | "error" | "info";

export interface GameSettingsFeedback {
  type: FeedbackType;
  message: string;
}

export type GameSettingsCategoryId =
  | "general"
  | "assets"
  | "hydra_cloud"
  | "compatibility"
  | "downloads"
  | "danger_zone";

export type GameSettingsAssetType = "icon" | "logo" | "hero";

interface UseGameSettingsControllerProps {
  visible: boolean;
  initialGame: LibraryGame | null;
  onClose: () => void;
  onGameUpdated?: (game: LibraryGame | null) => void;
}

function getLocalPath(value?: string | null) {
  return value?.startsWith("local:") ? value.slice("local:".length) : value;
}

function getAssetField(assetType: GameSettingsAssetType) {
  if (assetType === "icon") {
    return {
      customUrl: "customIconUrl",
      customOriginalPath: "customOriginalIconPath",
      url: "iconUrl",
      originalPath: "originalIconPath",
    } as const;
  }

  if (assetType === "logo") {
    return {
      customUrl: "customLogoImageUrl",
      customOriginalPath: "customOriginalLogoPath",
      url: "logoImageUrl",
      originalPath: "originalLogoPath",
    } as const;
  }

  return {
    customUrl: "customHeroImageUrl",
    customOriginalPath: "customOriginalHeroPath",
    url: "libraryHeroImageUrl",
    originalPath: "originalHeroPath",
  } as const;
}

function isSubscriptionActive(userDetails: UserDetails | null) {
  const expiresAt = new Date(userDetails?.subscription?.expiresAt ?? 0);

  return expiresAt > new Date();
}

async function updateGameTitle(game: LibraryGame, title: string) {
  if (game.shop === "custom") {
    await globalThis.window.electron.updateCustomGame({
      shop: game.shop,
      objectId: game.objectId,
      title,
      iconUrl: game.iconUrl || undefined,
      logoImageUrl: game.logoImageUrl || undefined,
      libraryHeroImageUrl: game.libraryHeroImageUrl || undefined,
      originalIconPath: getLocalPath(game.iconUrl) || undefined,
      originalLogoPath: getLocalPath(game.logoImageUrl) || undefined,
      originalHeroPath: getLocalPath(game.libraryHeroImageUrl) || undefined,
    });
    return;
  }

  await globalThis.window.electron.updateGameCustomAssets({
    shop: game.shop,
    objectId: game.objectId,
    title,
  });
}

async function updateGameAsset(
  game: LibraryGame,
  assetType: GameSettingsAssetType,
  copiedAssetUrl: string | null,
  sourcePath: string | null
) {
  const fields = getAssetField(assetType);

  if (game.shop === "custom") {
    await globalThis.window.electron.updateCustomGame({
      shop: game.shop,
      objectId: game.objectId,
      title: game.title,
      iconUrl:
        fields.url === "iconUrl"
          ? copiedAssetUrl || undefined
          : game.iconUrl || undefined,
      logoImageUrl:
        fields.url === "logoImageUrl"
          ? copiedAssetUrl || undefined
          : game.logoImageUrl || undefined,
      libraryHeroImageUrl:
        fields.url === "libraryHeroImageUrl"
          ? copiedAssetUrl || undefined
          : game.libraryHeroImageUrl || undefined,
      [fields.originalPath]: sourcePath || undefined,
    });
    return;
  }

  await globalThis.window.electron.updateGameCustomAssets({
    shop: game.shop,
    objectId: game.objectId,
    title: game.title,
    [fields.customUrl]: copiedAssetUrl,
    [fields.customOriginalPath]: sourcePath,
  });
}

export function useGameSettingsController({
  visible,
  initialGame,
  onClose,
  onGameUpdated,
}: UseGameSettingsControllerProps) {
  const [game, setGame] = useState<LibraryGame | null>(initialGame);
  const [selectedCategory, setSelectedCategory] =
    useState<GameSettingsCategoryId>("general");
  const [feedback, setFeedback] = useState<GameSettingsFeedback | null>(null);
  const [gameTitle, setGameTitle] = useState(initialGame?.title ?? "");
  const [launchOptions, setLaunchOptions] = useState(
    initialGame?.launchOptions ?? ""
  );
  const [updatingTitle, setUpdatingTitle] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [saveFolderPath, setSaveFolderPath] = useState<string | null>(null);
  const [loadingSaveFolder, setLoadingSaveFolder] = useState(false);
  const [steamShortcutExists, setSteamShortcutExists] = useState(false);
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(null);
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [protonVersions, setProtonVersions] = useState<ProtonVersion[]>([]);
  const [selectedProtonPath, setSelectedProtonPath] = useState(
    initialGame?.protonPath ?? ""
  );
  const [defaultWinePrefixPath, setDefaultWinePrefixPath] = useState<
    string | null
  >(null);
  const [gamemodeAvailable, setGamemodeAvailable] = useState(false);
  const [mangohudAvailable, setMangohudAvailable] = useState(false);
  const [winetricksAvailable, setWinetricksAvailable] = useState(false);
  const [autoRunGamemode, setAutoRunGamemode] = useState(false);
  const [autoRunMangohud, setAutoRunMangohud] = useState(false);
  const [isDeletingGameFiles, setIsDeletingGameFiles] = useState(false);
  const [isDeletingAchievements, setIsDeletingAchievements] = useState(false);

  const notify = useCallback((type: FeedbackType, message: string) => {
    setFeedback({ type, message });
  }, []);

  const refreshGame = useCallback(async () => {
    if (!initialGame) return null;

    const updatedGame = await globalThis.window.electron.getGameByObjectId(
      initialGame.shop,
      initialGame.objectId
    );

    setGame(updatedGame);
    onGameUpdated?.(updatedGame);

    return updatedGame;
  }, [initialGame, onGameUpdated]);

  useEffect(() => {
    if (!visible) return;

    setGame(initialGame);
    setSelectedCategory("general");
    setFeedback(null);
    setGameTitle(initialGame?.title ?? "");
    setLaunchOptions(initialGame?.launchOptions ?? "");
    setSelectedProtonPath(initialGame?.protonPath ?? "");
    setAutoRunGamemode(initialGame?.autoRunGamemode === true);
    setAutoRunMangohud(initialGame?.autoRunMangohud === true);
  }, [initialGame, visible]);

  useEffect(() => {
    if (!visible || !game) return;

    globalThis.window.electron
      .getUserPreferences()
      .then(setUserPreferences)
      .catch(noop);
    globalThis.window.electron
      .getMe()
      .then(setUserDetails)
      .catch(() => setUserDetails(null));
    if (game.shop === "custom") return;

    globalThis.window.electron
      .getUnlockedAchievements(game.objectId, game.shop)
      .then(setAchievements)
      .catch(() => setAchievements([]));
    globalThis.window.electron
      .checkSteamShortcut(game.shop, game.objectId)
      .then(setSteamShortcutExists)
      .catch(() => setSteamShortcutExists(false));
  }, [game, visible]);

  useEffect(() => {
    if (
      !visible ||
      !game ||
      game.shop === "custom" ||
      globalThis.window.electron.platform !== "win32"
    ) {
      setSaveFolderPath(null);
      return;
    }

    setLoadingSaveFolder(true);
    globalThis.window.electron
      .getGameSaveFolder(game.shop, game.objectId)
      .then(setSaveFolderPath)
      .catch(() => setSaveFolderPath(null))
      .finally(() => setLoadingSaveFolder(false));
  }, [game, visible]);

  useEffect(() => {
    if (!visible || globalThis.window.electron.platform !== "linux") {
      setProtonVersions([]);
      setDefaultWinePrefixPath(null);
      setGamemodeAvailable(false);
      setMangohudAvailable(false);
      setWinetricksAvailable(false);
      return;
    }

    globalThis.window.electron
      .getInstalledProtonVersions()
      .then(setProtonVersions)
      .catch(() => setProtonVersions([]));
    globalThis.window.electron
      .getDefaultWinePrefixSelectionPath()
      .then(setDefaultWinePrefixPath)
      .catch(() => setDefaultWinePrefixPath(null));
    globalThis.window.electron
      .isGamemodeAvailable()
      .then(setGamemodeAvailable)
      .catch(() => setGamemodeAvailable(false));
    globalThis.window.electron
      .isMangohudAvailable()
      .then(setMangohudAvailable)
      .catch(() => setMangohudAvailable(false));
    globalThis.window.electron
      .isWinetricksAvailable()
      .then(setWinetricksAvailable)
      .catch(() => setWinetricksAvailable(false));
  }, [visible]);

  const runAction = useCallback(
    async (actionId: string, action: () => Promise<void>, success?: string) => {
      setBusyAction(actionId);
      setFeedback(null);

      try {
        await action();
        if (success) notify("success", success);
      } catch (error) {
        notify(
          "error",
          error instanceof Error ? error.message : "Something went wrong"
        );
      } finally {
        setBusyAction(null);
      }
    },
    [notify]
  );

  const handleSaveTitle = useCallback(async () => {
    if (!game) return;

    const trimmedTitle = gameTitle.trim();
    if (!trimmedTitle) {
      notify("error", "Title is required");
      setGameTitle(game.title);
      return;
    }

    if (trimmedTitle === game.title) return;

    setUpdatingTitle(true);
    try {
      await updateGameTitle(game, trimmedTitle);
      await refreshGame();
      notify("success", "Game title updated");
    } catch (error) {
      setGameTitle(game.title);
      notify(
        "error",
        error instanceof Error ? error.message : "Could not update title"
      );
    } finally {
      setUpdatingTitle(false);
    }
  }, [game, gameTitle, notify, refreshGame]);

  const handleSelectExecutable = useCallback(async () => {
    if (!game) return;

    await runAction(
      "select-executable",
      async () => {
        const defaultPath =
          userPreferences?.downloadsPath ??
          (await globalThis.window.electron.getDefaultDownloadsPath());
        const { filePaths } = await globalThis.window.electron.showOpenDialog({
          properties: ["openFile"],
          defaultPath,
          filters: [
            {
              name: "Game executable",
              extensions: ["exe", "lnk"],
            },
          ],
        });

        const executablePath = filePaths[0];
        if (!executablePath) return;

        const gameUsingPath =
          await globalThis.window.electron.verifyExecutablePathInUse(
            executablePath
          );
        if (gameUsingPath) {
          throw new Error(`Executable already used by ${gameUsingPath.title}`);
        }

        await globalThis.window.electron.updateExecutablePath(
          game.shop,
          game.objectId,
          executablePath
        );
        await refreshGame();
      },
      "Executable path updated"
    );
  }, [game, refreshGame, runAction, userPreferences?.downloadsPath]);

  const handleClearExecutable = useCallback(async () => {
    if (!game) return;

    await runAction(
      "clear-executable",
      async () => {
        await globalThis.window.electron.updateExecutablePath(
          game.shop,
          game.objectId,
          null
        );
        await refreshGame();
      },
      "Executable path cleared"
    );
  }, [game, refreshGame, runAction]);

  const handleSaveLaunchOptions = useCallback(async () => {
    if (!game) return;

    await runAction(
      "save-launch-options",
      async () => {
        const trimmedValue = launchOptions.trim();
        await globalThis.window.electron.updateLaunchOptions(
          game.shop,
          game.objectId,
          trimmedValue || null
        );
        await refreshGame();
      },
      "Launch options updated"
    );
  }, [game, launchOptions, refreshGame, runAction]);

  const handleClearLaunchOptions = useCallback(async () => {
    setLaunchOptions("");
    if (!game) return;

    await runAction(
      "clear-launch-options",
      async () => {
        await globalThis.window.electron.updateLaunchOptions(
          game.shop,
          game.objectId,
          null
        );
        await refreshGame();
      },
      "Launch options cleared"
    );
  }, [game, refreshGame, runAction]);

  const handleOpenExecutableFolder = useCallback(async () => {
    if (!game) return;

    await runAction("open-executable", async () => {
      await globalThis.window.electron.openGameExecutablePath(
        game.shop,
        game.objectId
      );
    });
  }, [game, runAction]);

  const handleOpenSaveFolder = useCallback(async () => {
    if (!game || !saveFolderPath) return;

    await runAction("open-save-folder", async () => {
      await globalThis.window.electron.openGameSaveFolder(
        game.shop,
        game.objectId,
        saveFolderPath
      );
    });
  }, [game, runAction, saveFolderPath]);

  const handleCreateShortcut = useCallback(
    async (location: ShortcutLocation) => {
      if (!game) return;

      await runAction(
        `create-shortcut-${location}`,
        async () => {
          const success = await globalThis.window.electron.createGameShortcut(
            game.shop,
            game.objectId,
            location
          );
          if (!success) throw new Error("Could not create shortcut");
        },
        "Shortcut created"
      );
    },
    [game, runAction]
  );

  const handleCreateSteamShortcut = useCallback(
    async (options: CreateSteamShortcutOptions) => {
      if (!game) return;

      await runAction(
        "create-steam-shortcut",
        async () => {
          await globalThis.window.electron.createSteamShortcut(
            game.shop,
            game.objectId,
            options
          );
          const exists = await globalThis.window.electron.checkSteamShortcut(
            game.shop,
            game.objectId
          );
          setSteamShortcutExists(exists);
          await refreshGame();
        },
        "Steam shortcut created"
      );
    },
    [game, refreshGame, runAction]
  );

  const handleDeleteSteamShortcut = useCallback(async () => {
    if (!game) return;

    await runAction(
      "delete-steam-shortcut",
      async () => {
        await globalThis.window.electron.deleteSteamShortcut(
          game.shop,
          game.objectId
        );
        setSteamShortcutExists(false);
        await refreshGame();
      },
      "Steam shortcut deleted"
    );
  }, [game, refreshGame, runAction]);

  const handleUpdateAsset = useCallback(
    async (assetType: GameSettingsAssetType, sourcePath: string | null) => {
      if (!game) return;

      await runAction(
        `update-asset-${assetType}`,
        async () => {
          const copiedAssetUrl = sourcePath
            ? await globalThis.window.electron.copyCustomGameAsset(
                sourcePath,
                assetType
              )
            : null;

          await updateGameAsset(game, assetType, copiedAssetUrl, sourcePath);
          await refreshGame();
        },
        sourcePath ? "Asset updated" : "Asset removed"
      );
    },
    [game, refreshGame, runAction]
  );

  const handleChooseAsset = useCallback(
    async (assetType: GameSettingsAssetType) => {
      const { filePaths } = await globalThis.window.electron.showOpenDialog({
        properties: ["openFile"],
        filters: [
          {
            name: "Images",
            extensions: ["jpg", "jpeg", "png", "webp", "ico"],
          },
        ],
      });

      if (filePaths[0]) {
        await handleUpdateAsset(assetType, filePaths[0]);
      }
    },
    [handleUpdateAsset]
  );

  const handleResetAsset = useCallback(
    async (assetType: GameSettingsAssetType) => {
      if (game?.shop !== "custom") {
        await handleUpdateAsset(assetType, null);
        return;
      }

      const fields = getAssetField(assetType);
      const originalPath = getLocalPath(game?.[fields.url]);

      await handleUpdateAsset(assetType, originalPath ?? null);
    },
    [game, handleUpdateAsset]
  );

  const handleChangeWinePrefixPath = useCallback(async () => {
    if (!game) return;

    await runAction(
      "wine-prefix",
      async () => {
        const { filePaths } = await globalThis.window.electron.showOpenDialog({
          properties: ["openDirectory"],
          defaultPath: game.winePrefixPath ?? defaultWinePrefixPath ?? "",
        });
        if (!filePaths[0]) return;

        await globalThis.window.electron.selectGameWinePrefix(
          game.shop,
          game.objectId,
          filePaths[0]
        );
        await refreshGame();
      },
      "Wine prefix updated"
    );
  }, [defaultWinePrefixPath, game, refreshGame, runAction]);

  const handleClearWinePrefixPath = useCallback(async () => {
    if (!game) return;

    await runAction(
      "clear-wine-prefix",
      async () => {
        await globalThis.window.electron.selectGameWinePrefix(
          game.shop,
          game.objectId,
          null
        );
        await refreshGame();
      },
      "Wine prefix cleared"
    );
  }, [game, refreshGame, runAction]);

  const handleChangeProtonVersion = useCallback(
    async (protonPath: string) => {
      if (!game) return;

      setSelectedProtonPath(protonPath);
      await runAction(
        "proton-version",
        async () => {
          await globalThis.window.electron.selectGameProtonPath(
            game.shop,
            game.objectId,
            protonPath || null
          );
          await refreshGame();
        },
        "Proton version updated"
      );
    },
    [game, refreshGame, runAction]
  );

  const handleToggleGamemode = useCallback(async () => {
    if (!game) return;
    const nextValue = !autoRunGamemode;
    setAutoRunGamemode(nextValue);

    await runAction("gamemode", async () => {
      await globalThis.window.electron.toggleGameGamemode(
        game.shop,
        game.objectId,
        nextValue
      );
      await refreshGame();
    });
  }, [autoRunGamemode, game, refreshGame, runAction]);

  const handleToggleMangohud = useCallback(async () => {
    if (!game) return;
    const nextValue = !autoRunMangohud;
    setAutoRunMangohud(nextValue);

    await runAction("mangohud", async () => {
      await globalThis.window.electron.toggleGameMangohud(
        game.shop,
        game.objectId,
        nextValue
      );
      await refreshGame();
    });
  }, [autoRunMangohud, game, refreshGame, runAction]);

  const handleOpenWinetricks = useCallback(async () => {
    if (!game) return;

    await runAction(
      "winetricks",
      async () => {
        const success = await globalThis.window.electron.openGameWinetricks(
          game.shop,
          game.objectId
        );
        if (!success) throw new Error("Could not open Winetricks");
      },
      "Winetricks opened"
    );
  }, [game, runAction]);

  const handleToggleAutomaticCloudSync = useCallback(async () => {
    if (!game) return;
    const nextValue = !game.automaticCloudSync;

    await runAction("automatic-cloud-sync", async () => {
      await globalThis.window.electron.toggleAutomaticCloudSync(
        game.shop,
        game.objectId,
        nextValue
      );
      await refreshGame();
    });
  }, [game, refreshGame, runAction]);

  const handleOpenDownloadFolder = useCallback(async () => {
    if (!game) return;

    await runAction("download-folder", async () => {
      await globalThis.window.electron.openGameInstallerPath(
        game.shop,
        game.objectId
      );
    });
  }, [game, runAction]);

  const handleRemoveGameFiles = useCallback(async () => {
    if (!game) return;

    setIsDeletingGameFiles(true);
    await runAction(
      "remove-files",
      async () => {
        await globalThis.window.electron.deleteGameFolder(
          game.shop,
          game.objectId
        );
        await refreshGame();
      },
      "Game files removed"
    );
    setIsDeletingGameFiles(false);
  }, [game, refreshGame, runAction]);

  const handleRemoveFromLibrary = useCallback(async () => {
    if (!game) return;

    await runAction(
      "remove-library",
      async () => {
        if (game.download?.status === "active") {
          await globalThis.window.electron.cancelGameDownload(
            game.shop,
            game.objectId
          );
        }
        await globalThis.window.electron.removeGameFromLibrary(
          game.shop,
          game.objectId
        );
        onGameUpdated?.(null);
        onClose();
      },
      "Game removed from library"
    );
  }, [game, onClose, onGameUpdated, runAction]);

  const handleResetAchievements = useCallback(async () => {
    if (!game) return;

    setIsDeletingAchievements(true);
    await runAction(
      "reset-achievements",
      async () => {
        await globalThis.window.electron.resetGameAchievements(
          game.shop,
          game.objectId
        );
        await refreshGame();
        setAchievements([]);
      },
      "Achievements reset"
    );
    setIsDeletingAchievements(false);
  }, [game, refreshGame, runAction]);

  const handleChangePlaytime = useCallback(
    async (playtimeInSeconds: number) => {
      if (!game) return;

      await runAction(
        "change-playtime",
        async () => {
          await globalThis.window.electron.changeGamePlayTime(
            game.shop,
            game.objectId,
            playtimeInSeconds
          );
          await refreshGame();
        },
        "Playtime updated"
      );
    },
    [game, refreshGame, runAction]
  );

  const displayedWinePrefixPath = useMemo(() => {
    if (!game) return null;

    return (
      game.winePrefixPath ??
      (defaultWinePrefixPath
        ? `${defaultWinePrefixPath}/${game.objectId}`
        : null)
    );
  }, [defaultWinePrefixPath, game]);

  const hasAchievements =
    achievements.some((achievement) => achievement.unlocked) ||
    (game?.unlockedAchievementCount ?? 0) > 0;
  const hasActiveSubscription = isSubscriptionActive(userDetails);
  const globalAutoRunGamemode = userPreferences?.autoRunGamemode === true;
  const globalAutoRunMangohud = userPreferences?.autoRunMangohud === true;
  const isGameDownloading = game?.download?.status === "active";

  return {
    game,
    selectedCategory,
    setSelectedCategory,
    feedback,
    setFeedback,
    gameTitle,
    setGameTitle,
    launchOptions,
    setLaunchOptions,
    updatingTitle,
    busyAction,
    saveFolderPath,
    loadingSaveFolder,
    steamShortcutExists,
    userDetails,
    hasActiveSubscription,
    hasAchievements,
    protonVersions,
    selectedProtonPath,
    displayedWinePrefixPath,
    gamemodeAvailable,
    mangohudAvailable,
    winetricksAvailable,
    autoRunGamemode,
    autoRunMangohud,
    globalAutoRunGamemode,
    globalAutoRunMangohud,
    isGameDownloading,
    isDeletingGameFiles,
    isDeletingAchievements,
    notify,
    refreshGame,
    handleSaveTitle,
    handleSelectExecutable,
    handleClearExecutable,
    handleSaveLaunchOptions,
    handleClearLaunchOptions,
    handleOpenExecutableFolder,
    handleOpenSaveFolder,
    handleCreateShortcut,
    handleCreateSteamShortcut,
    handleDeleteSteamShortcut,
    handleChooseAsset,
    handleUpdateAsset,
    handleResetAsset,
    handleChangeWinePrefixPath,
    handleClearWinePrefixPath,
    handleChangeProtonVersion,
    handleToggleGamemode,
    handleToggleMangohud,
    handleOpenWinetricks,
    handleToggleAutomaticCloudSync,
    handleOpenDownloadFolder,
    handleRemoveGameFiles,
    handleRemoveFromLibrary,
    handleResetAchievements,
    handleChangePlaytime,
  };
}

export type GameSettingsController = ReturnType<
  typeof useGameSettingsController
>;

function noop() {
  return undefined;
}
