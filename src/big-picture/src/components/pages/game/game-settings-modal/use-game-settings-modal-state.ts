import type { LibraryGame } from "@types";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { platformToSystem } from "@renderer/helpers";
import { useBigPictureToast } from "../../../../hooks";
import type { GameCloudSettingsProps } from "./cloud-tab";
import type { GameCustomizationSettingsProps } from "./customization-tab";
import type { GameLaunchSettingsProps } from "./launch-tab";

interface UseGameSettingsModalStateParams {
  game: LibraryGame | null;
  visible: boolean;
  updateGame: () => Promise<void>;
  refreshGameDetails: (options?: {
    showLoadingState?: boolean;
  }) => Promise<void>;
}

interface UseGameSettingsModalStateResult {
  launchSettings: GameLaunchSettingsProps | null;
  customizationSettings: GameCustomizationSettingsProps | null;
  cloudSettings: GameCloudSettingsProps | null;
}

export function useGameSettingsModalState({
  game,
  visible,
  updateGame,
  refreshGameDetails,
}: Readonly<UseGameSettingsModalStateParams>): UseGameSettingsModalStateResult {
  const { t } = useTranslation("game_details");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const [gameTitle, setGameTitle] = useState("");
  const [launchOptions, setLaunchOptions] = useState("");
  const [loadingSaveFolder, setLoadingSaveFolder] = useState(false);
  const [saveFolderPath, setSaveFolderPath] = useState<string | null>(null);
  const [steamShortcutExists, setSteamShortcutExists] = useState(false);
  const [creatingSteamShortcut, setCreatingSteamShortcut] = useState(false);
  const [updatingGameTitle, setUpdatingGameTitle] = useState(false);
  const [automaticCloudSync, setAutomaticCloudSync] = useState(
    () => game?.automaticCloudSync ?? false
  );
  const launchOptionsDebounceRef = useRef<number | null>(null);
  const persistedLaunchOptionsRef = useRef("");
  const selectedDisc = useMemo(() => {
    const discs = game?.discs ?? [];

    return (
      discs.find((disc) => disc.path === game?.selectedDiscPath) ??
      discs[0] ??
      null
    );
  }, [game?.discs, game?.selectedDiscPath]);

  useEffect(() => {
    setAutomaticCloudSync(game?.automaticCloudSync ?? false);
  }, [game?.automaticCloudSync]);

  useEffect(() => {
    if (!visible) return;
    persistedLaunchOptionsRef.current = game?.launchOptions ?? "";
    setLaunchOptions(game?.launchOptions ?? "");
  }, [game?.id, game?.launchOptions, visible]);

  useEffect(() => {
    if (!visible) return;
    setGameTitle(game?.title ?? "");
  }, [game?.id, game?.title, visible]);

  useEffect(() => {
    if (
      !visible ||
      !game ||
      game.shop === "custom" ||
      globalThis.window.electron.platform !== "win32"
    ) {
      setLoadingSaveFolder(false);
      setSaveFolderPath(null);
      return;
    }

    setLoadingSaveFolder(true);
    setSaveFolderPath(null);
    globalThis.window.electron
      .getGameSaveFolder(game.shop, game.objectId)
      .then(setSaveFolderPath)
      .catch(() => setSaveFolderPath(null))
      .finally(() => setLoadingSaveFolder(false));
  }, [game, visible]);

  useEffect(() => {
    if (!visible || !game || game.shop === "custom") {
      setSteamShortcutExists(false);
      return;
    }

    globalThis.window.electron
      .checkSteamShortcut(game.shop, game.objectId)
      .then(setSteamShortcutExists)
      .catch(() => setSteamShortcutExists(false));
  }, [game, visible]);

  const persistLaunchOptions = useCallback(
    async (value: string) => {
      if (!game) return;

      if (launchOptionsDebounceRef.current !== null) {
        globalThis.window.clearTimeout(launchOptionsDebounceRef.current);
        launchOptionsDebounceRef.current = null;
      }

      if (value === persistedLaunchOptionsRef.current) {
        return;
      }

      try {
        await globalThis.window.electron.updateLaunchOptions(
          game.shop,
          game.objectId,
          value === "" ? null : value
        );
        persistedLaunchOptionsRef.current = value;
        await updateGame();
      } catch {
        showErrorToast(t("edit_game_modal_failed"));
      }
    },
    [game, showErrorToast, t, updateGame]
  );

  const handleChangeGameTitle = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setGameTitle(event.target.value);
    },
    []
  );

  const saveGameTitle = useCallback(
    async (title: string) => {
      if (!game) return;

      if (game.shop === "custom") {
        await globalThis.window.electron.updateCustomGame({
          shop: game.shop,
          objectId: game.objectId,
          title,
          iconUrl: game.iconUrl || undefined,
          logoImageUrl: game.logoImageUrl || undefined,
          libraryHeroImageUrl: game.libraryHeroImageUrl || undefined,
        });
      } else {
        await globalThis.window.electron.updateGameCustomAssets({
          shop: game.shop,
          objectId: game.objectId,
          title,
        });
      }

      await updateGame();
      setGameTitle(title);
    },
    [game, updateGame]
  );

  const handleBlurGameTitle = useCallback(async () => {
    if (!game || updatingGameTitle) return;

    const trimmed = gameTitle.trim();

    if (!trimmed) {
      if (game.shop !== "custom") {
        setUpdatingGameTitle(true);

        try {
          const assets = await globalThis.window.electron.getGameAssets(
            game.objectId,
            game.shop,
            { forceFresh: true }
          );

          if (assets?.title) {
            await saveGameTitle(assets.title);
            return;
          }
        } catch {
          // Fall through to revert
        } finally {
          setUpdatingGameTitle(false);
        }
      }

      setGameTitle(game.title ?? "");
      showErrorToast(t("edit_game_modal_fill_required"));
      return;
    }

    if (trimmed === (game.title ?? "").trim()) {
      setGameTitle(game.title ?? "");
      return;
    }

    setUpdatingGameTitle(true);

    try {
      await saveGameTitle(trimmed);
    } catch (error) {
      setGameTitle(game.title ?? "");
      showErrorToast(
        error instanceof Error ? error.message : t("edit_game_modal_failed")
      );
    } finally {
      setUpdatingGameTitle(false);
    }
  }, [game, gameTitle, saveGameTitle, showErrorToast, t, updatingGameTitle]);

  const handleSelectCustomizationAsset = useCallback(
    async (assetType: "icon" | "logo" | "hero") => {
      if (!game) return;

      const { filePaths } = await globalThis.window.electron.showOpenDialog({
        properties: ["openFile"],
        filters: [
          {
            name: "Image files",
            extensions: ["jpg", "jpeg", "png", "gif", "webp"],
          },
        ],
      });

      const sourcePath = filePaths?.[0];

      if (!sourcePath) return;

      try {
        const copiedAssetUrl =
          await globalThis.window.electron.copyCustomGameAsset(
            sourcePath,
            assetType
          );

        if (game.shop === "custom") {
          await globalThis.window.electron.updateCustomGame({
            shop: game.shop,
            objectId: game.objectId,
            title: gameTitle.trim() || game.title || "",
            iconUrl:
              assetType === "icon" ? copiedAssetUrl : game.iconUrl || undefined,
            logoImageUrl:
              assetType === "logo"
                ? copiedAssetUrl
                : game.logoImageUrl || undefined,
            libraryHeroImageUrl:
              assetType === "hero"
                ? copiedAssetUrl
                : game.libraryHeroImageUrl || undefined,
          });
        } else {
          await globalThis.window.electron.updateGameCustomAssets({
            shop: game.shop,
            objectId: game.objectId,
            title: gameTitle.trim() || game.title || "",
            customIconUrl:
              assetType === "icon"
                ? copiedAssetUrl
                : game.customIconUrl || null,
            customLogoImageUrl:
              assetType === "logo"
                ? copiedAssetUrl
                : game.customLogoImageUrl || null,
            customHeroImageUrl:
              assetType === "hero"
                ? copiedAssetUrl
                : game.customHeroImageUrl || null,
            customOriginalIconPath: assetType === "icon" ? null : undefined,
            customOriginalLogoPath: assetType === "logo" ? null : undefined,
            customOriginalHeroPath: assetType === "hero" ? null : undefined,
          });
        }

        await refreshGameDetails();
      } catch (error) {
        showErrorToast(
          error instanceof Error ? error.message : t("edit_game_modal_failed")
        );
      }
    },
    [game, gameTitle, refreshGameDetails, showErrorToast, t]
  );

  const handleClearCustomizationAsset = useCallback(
    async (assetType: "icon" | "logo" | "hero") => {
      if (!game) return;

      try {
        if (game.shop === "custom") {
          await globalThis.window.electron.updateCustomGame({
            shop: game.shop,
            objectId: game.objectId,
            title: gameTitle.trim() || game.title || "",
            iconUrl:
              assetType === "icon" ? undefined : game.iconUrl || undefined,
            logoImageUrl:
              assetType === "logo" ? undefined : game.logoImageUrl || undefined,
            libraryHeroImageUrl:
              assetType === "hero"
                ? undefined
                : game.libraryHeroImageUrl || undefined,
          });
        } else {
          await globalThis.window.electron.updateGameCustomAssets({
            shop: game.shop,
            objectId: game.objectId,
            title: gameTitle.trim() || game.title || "",
            customIconUrl:
              assetType === "icon" ? null : game.customIconUrl || undefined,
            customLogoImageUrl:
              assetType === "logo"
                ? null
                : game.customLogoImageUrl || undefined,
            customHeroImageUrl:
              assetType === "hero"
                ? null
                : game.customHeroImageUrl || undefined,
            customOriginalIconPath: assetType === "icon" ? null : undefined,
            customOriginalLogoPath: assetType === "logo" ? null : undefined,
            customOriginalHeroPath: assetType === "hero" ? null : undefined,
          });
        }

        await refreshGameDetails();
      } catch (error) {
        showErrorToast(
          error instanceof Error ? error.message : t("edit_game_modal_failed")
        );
      }
    },
    [game, gameTitle, refreshGameDetails, showErrorToast, t]
  );

  useEffect(() => {
    if (launchOptionsDebounceRef.current !== null) {
      globalThis.window.clearTimeout(launchOptionsDebounceRef.current);
      launchOptionsDebounceRef.current = null;
    }

    if (!visible || !game) return;

    const nextValue = launchOptions;
    const currentValue = persistedLaunchOptionsRef.current;

    if (nextValue === currentValue) return;

    launchOptionsDebounceRef.current = globalThis.window.setTimeout(() => {
      void persistLaunchOptions(nextValue);
    }, 500);

    return () => {
      if (launchOptionsDebounceRef.current !== null) {
        globalThis.window.clearTimeout(launchOptionsDebounceRef.current);
        launchOptionsDebounceRef.current = null;
      }
    };
  }, [game, launchOptions, persistLaunchOptions, visible]);

  const getDownloadsPath = useCallback(async () => {
    const userPreferences = await globalThis.window.electron
      .getUserPreferences()
      .catch(() => null);

    return (
      userPreferences?.downloadsPath ??
      (await globalThis.window.electron.getDefaultDownloadsPath())
    );
  }, []);

  const selectGameExecutable = useCallback(async () => {
    const downloadsPath = await getDownloadsPath();
    const { filePaths } = await globalThis.window.electron.showOpenDialog({
      properties: ["openFile"],
      defaultPath: downloadsPath,
      filters: [
        {
          name: "Game executable",
          extensions: ["exe", "lnk"],
        },
      ],
    });

    if (filePaths && filePaths.length > 0) {
      return filePaths[0];
    }

    return null;
  }, [getDownloadsPath]);

  const handleChangeExecutableLocation = useCallback(async () => {
    if (!game) return;

    const path = await selectGameExecutable();
    if (!path) return;

    const gameUsingPath =
      await globalThis.window.electron.verifyExecutablePathInUse(path);

    if (
      gameUsingPath &&
      (gameUsingPath.objectId !== game.objectId ||
        gameUsingPath.shop !== game.shop)
    ) {
      showErrorToast(
        t("executable_path_in_use", { game: gameUsingPath.title })
      );
      return;
    }

    await globalThis.window.electron.updateExecutablePath(
      game.shop,
      game.objectId,
      path
    );
    await updateGame();
  }, [game, selectGameExecutable, showErrorToast, t, updateGame]);

  const handleClearExecutablePath = useCallback(async () => {
    if (!game) return;

    await globalThis.window.electron.updateExecutablePath(
      game.shop,
      game.objectId,
      null
    );
    await updateGame();
  }, [game, updateGame]);

  const handleOpenSaveFolder = useCallback(async () => {
    if (!game || !saveFolderPath) return;

    await globalThis.window.electron.openGameSaveFolder(
      game.shop,
      game.objectId,
      saveFolderPath
    );
  }, [game, saveFolderPath]);

  const handleCreateShortcut = useCallback(
    async (location: "desktop" | "start_menu") => {
      if (!game) return;

      const success = await globalThis.window.electron
        .createGameShortcut(game.shop, game.objectId, location)
        .catch(() => false);

      if (success) {
        showSuccessToast(t("create_shortcut_success"));
      } else {
        showErrorToast(t("create_shortcut_error"));
      }
    },
    [game, showErrorToast, showSuccessToast, t]
  );

  const handleCreateSteamShortcut = useCallback(async () => {
    if (!game || game.shop === "custom") return;

    try {
      setCreatingSteamShortcut(true);
      await globalThis.window.electron.createSteamShortcut(
        game.shop,
        game.objectId
      );
      showSuccessToast(t("create_shortcut_success"), {
        message: t("you_might_need_to_restart_steam"),
      });
      setSteamShortcutExists(true);
      await updateGame();
    } catch {
      showErrorToast(t("create_shortcut_error"));
    } finally {
      setCreatingSteamShortcut(false);
    }
  }, [game, showErrorToast, showSuccessToast, t, updateGame]);

  const handleDeleteSteamShortcut = useCallback(async () => {
    if (!game || game.shop === "custom") return;

    try {
      setCreatingSteamShortcut(true);
      await globalThis.window.electron.deleteSteamShortcut(
        game.shop,
        game.objectId
      );
      showSuccessToast(t("delete_shortcut_success"), {
        message: t("you_might_need_to_restart_steam"),
      });
      setSteamShortcutExists(false);
      await updateGame();
    } catch {
      showErrorToast(t("delete_shortcut_error"));
    } finally {
      setCreatingSteamShortcut(false);
    }
  }, [game, showErrorToast, showSuccessToast, t, updateGame]);

  const handleClearLaunchOptions = useCallback(() => {
    setLaunchOptions("");
  }, []);

  const handleBlurLaunchOptions = useCallback(() => {
    void persistLaunchOptions(launchOptions);
  }, [launchOptions, persistLaunchOptions]);

  const handleSelectDisc = useCallback(
    async (discPath: string) => {
      if (!game) return;

      await globalThis.window.electron.updateClassicsDisc(
        game.shop,
        game.objectId,
        {
          selectedDiscPath: discPath,
        }
      );
      await updateGame();
    },
    [game, updateGame]
  );

  const handleToggleDontAskDiscSelection = useCallback(
    async (checked: boolean) => {
      if (!game) return;

      await globalThis.window.electron.updateClassicsDisc(
        game.shop,
        game.objectId,
        {
          dontAskDiscSelection: checked,
        }
      );
      await updateGame();
    },
    [game, updateGame]
  );

  const addDiscFromPath = useCallback(
    async (fullPath: string) => {
      if (!game) return;

      const fileName = fullPath.split(/[\\/]/).pop() ?? fullPath;
      const nextIndex = (game.discs?.length ?? 0) + 1;
      await globalThis.window.electron.updateClassicsDisc(
        game.shop,
        game.objectId,
        {
          addDisc: {
            path: fullPath,
            label: `Disc ${nextIndex}`,
            fileName,
          },
          selectedDiscPath: fullPath,
        }
      );
      await updateGame();
    },
    [game, updateGame]
  );

  const handleAddDiscFile = useCallback(async () => {
    if (!game) return;

    const system = platformToSystem(game.platform);
    const extensions = system
      ? await globalThis.window.electron.getEmulatorRomExtensions(system)
      : ["*"];
    const result = await globalThis.window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: t("rom_file"), extensions },
        { name: t("all_files"), extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return;
    await addDiscFromPath(result.filePaths[0]);
  }, [addDiscFromPath, game, t]);

  const handleRemoveSelectedDisc = useCallback(async () => {
    if (!game || !selectedDisc) return;

    await globalThis.window.electron.updateClassicsDisc(
      game.shop,
      game.objectId,
      {
        removeDiscPath: selectedDisc.path,
      }
    );
    await updateGame();
  }, [game, selectedDisc, updateGame]);

  const handleRemoveAllDiscs = useCallback(async () => {
    if (!game) return;

    const discsToRemove = game.discs ?? [];
    if (discsToRemove.length === 0) return;

    for (const disc of discsToRemove) {
      await globalThis.window.electron.updateClassicsDisc(
        game.shop,
        game.objectId,
        {
          removeDiscPath: disc.path,
        }
      );
    }

    await updateGame();
  }, [game, updateGame]);

  const handleToggleAutomaticCloudSync = useCallback(
    async (checked: boolean) => {
      if (!game) return;
      setAutomaticCloudSync(checked);
      try {
        await window.electron.toggleAutomaticCloudSync(
          game.shop,
          game.objectId,
          checked
        );
        void updateGame();
      } catch {
        setAutomaticCloudSync(!checked);
      }
    },
    [game, updateGame]
  );

  useEffect(
    () => () => {
      if (launchOptionsDebounceRef.current !== null) {
        globalThis.window.clearTimeout(launchOptionsDebounceRef.current);
      }
    },
    []
  );

  const launchSettings = useMemo(() => {
    if (!game) return null;

    return {
      game,
      launchOptions,
      loadingSaveFolder,
      saveFolderPath,
      creatingSteamShortcut,
      steamShortcutExists,
      shouldShowCreateStartMenuShortcut:
        globalThis.window.electron.platform === "win32",
      onChangeExecutableLocation: handleChangeExecutableLocation,
      onClearExecutablePath: handleClearExecutablePath,
      onOpenSaveFolder: handleOpenSaveFolder,
      onChangeLaunchOptions: setLaunchOptions,
      onBlurLaunchOptions: handleBlurLaunchOptions,
      onClearLaunchOptions: handleClearLaunchOptions,
      onCreateShortcut: handleCreateShortcut,
      onCreateSteamShortcut: handleCreateSteamShortcut,
      onDeleteSteamShortcut: handleDeleteSteamShortcut,
      onSelectDisc: handleSelectDisc,
      onToggleDontAskDiscSelection: handleToggleDontAskDiscSelection,
      onAddDiscFile: handleAddDiscFile,
      onRemoveSelectedDisc: handleRemoveSelectedDisc,
      onRemoveAllDiscs: handleRemoveAllDiscs,
    } satisfies GameLaunchSettingsProps;
  }, [
    creatingSteamShortcut,
    game,
    handleAddDiscFile,
    handleBlurLaunchOptions,
    handleChangeExecutableLocation,
    handleClearExecutablePath,
    handleClearLaunchOptions,
    handleCreateShortcut,
    handleCreateSteamShortcut,
    handleDeleteSteamShortcut,
    handleOpenSaveFolder,
    handleRemoveAllDiscs,
    handleRemoveSelectedDisc,
    handleSelectDisc,
    handleToggleDontAskDiscSelection,
    launchOptions,
    loadingSaveFolder,
    saveFolderPath,
    steamShortcutExists,
  ]);

  const customizationSettings = useMemo(() => {
    if (!game) return null;

    return {
      game,
      gameTitle,
      updatingGameTitle,
      onChangeGameTitle: handleChangeGameTitle,
      onBlurGameTitle: handleBlurGameTitle,
      onSelectAsset: handleSelectCustomizationAsset,
      onClearAsset: handleClearCustomizationAsset,
    } satisfies GameCustomizationSettingsProps;
  }, [
    game,
    gameTitle,
    handleBlurGameTitle,
    handleChangeGameTitle,
    handleClearCustomizationAsset,
    handleSelectCustomizationAsset,
    updatingGameTitle,
  ]);

  const cloudSettings = useMemo(() => {
    if (!game) return null;

    return {
      game,
      automaticCloudSync,
      onToggleAutomaticCloudSync: handleToggleAutomaticCloudSync,
    } satisfies GameCloudSettingsProps;
  }, [automaticCloudSync, game, handleToggleAutomaticCloudSync]);

  return {
    launchSettings,
    customizationSettings,
    cloudSettings,
  };
}
