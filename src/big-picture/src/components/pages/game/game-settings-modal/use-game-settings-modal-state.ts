import type { LibraryGame } from "@types";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { platformToSystem } from "@renderer/helpers";
import { getGameExecutableFilters } from "@shared";
import type { FileFilter } from "../../../common";
import { useBigPictureToast } from "../../../../hooks";
import {
  applyClassicsDiscUpdate,
  buildAddedDiscPayload,
  executeSteamShortcutAction as runSharedSteamShortcutAction,
  type ClassicsDiscUpdatePayload,
} from "../shared-actions";
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

type CustomAssetType = "icon" | "logo" | "hero" | "grid";
const IMAGE_FILE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "jfif",
  "png",
  "gif",
  "webp",
] as const;

export function useGameSettingsModalState({
  game,
  visible,
  updateGame,
  refreshGameDetails,
}: Readonly<UseGameSettingsModalStateParams>): UseGameSettingsModalStateResult {
  const { t } = useTranslation(["game_details", "sidebar"]);
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
  const [execPickerInitialPath, setExecPickerInitialPath] = useState("");
  const [discPickerFilters, setDiscPickerFilters] = useState<FileFilter[]>([]);
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

  const getDownloadsPath = useCallback(async () => {
    const userPreferences = await globalThis.window.electron
      .getUserPreferences()
      .catch(() => null);

    return (
      userPreferences?.downloadsPath ??
      (await globalThis.window.electron.getDefaultDownloadsPath())
    );
  }, []);

  useEffect(() => {
    if (!visible || game?.shop === "launchbox") return;

    let cancelled = false;

    getDownloadsPath().then((path) => {
      if (!cancelled) setExecPickerInitialPath(path);
    });

    return () => {
      cancelled = true;
    };
  }, [game?.shop, getDownloadsPath, visible]);

  useEffect(() => {
    if (!visible || game?.shop !== "launchbox") {
      setDiscPickerFilters([]);
      return;
    }

    let cancelled = false;

    const loadDiscFilters = async () => {
      const system = platformToSystem(game.platform);
      const extensions = system
        ? await globalThis.window.electron.getEmulatorRomExtensions(system)
        : ["*"];

      if (!cancelled) {
        setDiscPickerFilters([
          { name: t("rom_file"), extensions },
          { name: t("all_files"), extensions: ["*"] },
        ]);
      }
    };

    void loadDiscFilters();

    return () => {
      cancelled = true;
    };
  }, [game, t, visible]);

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

  const getEffectiveGameTitle = useCallback(() => {
    return gameTitle.trim() || game?.title || "";
  }, [game?.title, gameTitle]);

  const buildCustomGameAssetPayload = useCallback(
    (assetType: CustomAssetType, assetValue: string | undefined) => {
      if (!game) return null;

      return {
        shop: game.shop,
        objectId: game.objectId,
        title: getEffectiveGameTitle(),
        iconUrl: assetType === "icon" ? assetValue : game.iconUrl || undefined,
        logoImageUrl:
          assetType === "logo" ? assetValue : game.logoImageUrl || undefined,
        libraryHeroImageUrl:
          assetType === "hero"
            ? assetValue
            : game.libraryHeroImageUrl || undefined,
      };
    },
    [game, getEffectiveGameTitle]
  );

  const buildGameCustomAssetsPayload = useCallback(
    (assetType: CustomAssetType, assetValue: string | null) => {
      if (!game) return null;

      return {
        shop: game.shop,
        objectId: game.objectId,
        title: getEffectiveGameTitle(),
        customIconUrl:
          assetType === "icon" ? assetValue : game.customIconUrl || undefined,
        customLogoImageUrl:
          assetType === "logo"
            ? assetValue
            : game.customLogoImageUrl || undefined,
        customHeroImageUrl:
          assetType === "hero"
            ? assetValue
            : game.customHeroImageUrl || undefined,
        customCoverImageUrl:
          assetType === "grid"
            ? assetValue
            : game.customCoverImageUrl || undefined,
        customOriginalIconPath: assetType === "icon" ? null : undefined,
        customOriginalLogoPath: assetType === "logo" ? null : undefined,
        customOriginalHeroPath: assetType === "hero" ? null : undefined,
        customOriginalCoverPath: assetType === "grid" ? null : undefined,
      };
    },
    [game, getEffectiveGameTitle]
  );

  const updateCustomizationAsset = useCallback(
    async (
      assetType: CustomAssetType,
      assetValue: string | null | undefined
    ) => {
      if (!game) return;

      if (game.shop === "custom") {
        const payload = buildCustomGameAssetPayload(
          assetType,
          assetValue ?? undefined
        );

        if (!payload) return;

        await globalThis.window.electron.updateCustomGame(payload);
        return;
      }

      const payload = buildGameCustomAssetsPayload(
        assetType,
        assetValue ?? null
      );

      if (!payload) return;

      await globalThis.window.electron.updateGameCustomAssets(payload);
    },
    [buildCustomGameAssetPayload, buildGameCustomAssetsPayload, game]
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

  const handleProcessAssetPath = useCallback(
    async (
      sourcePath: string,
      assetType: CustomAssetType
    ): Promise<string | null> => {
      if (!game) return null;

      try {
        const copiedAssetUrl =
          await globalThis.window.electron.copyCustomGameAsset(
            sourcePath,
            assetType
          );
        await updateCustomizationAsset(assetType, copiedAssetUrl);
        void refreshGameDetails().catch(() => {});
        showSuccessToast(t("steamgriddb_artwork_updated"));
        return copiedAssetUrl;
      } catch (error) {
        showErrorToast(
          error instanceof Error ? error.message : t("edit_game_modal_failed")
        );
        return null;
      }
    },
    [
      game,
      refreshGameDetails,
      showErrorToast,
      showSuccessToast,
      t,
      updateCustomizationAsset,
    ]
  );

  const handleClearCustomizationAsset = useCallback(
    async (
      assetType: CustomAssetType,
      clearArtworkSelection: boolean
    ): Promise<boolean> => {
      if (!game) return false;

      try {
        if (clearArtworkSelection) {
          await globalThis.window.electron.setGameArtworkSelection({
            shop: game.shop,
            objectId: game.objectId,
            type: assetType,
            clear: true,
          });
        } else {
          await updateCustomizationAsset(
            assetType,
            game.shop === "custom" ? undefined : null
          );
        }

        void refreshGameDetails().catch(() => {});
        showSuccessToast(t("steamgriddb_artwork_reset"));
        return true;
      } catch (error) {
        showErrorToast(
          error instanceof Error ? error.message : t("edit_game_modal_failed")
        );
        return false;
      }
    },
    [
      game,
      refreshGameDetails,
      showErrorToast,
      showSuccessToast,
      t,
      updateCustomizationAsset,
    ]
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
      persistLaunchOptions(nextValue).catch(() => {});
    }, 500);

    return () => {
      if (launchOptionsDebounceRef.current !== null) {
        globalThis.window.clearTimeout(launchOptionsDebounceRef.current);
        launchOptionsDebounceRef.current = null;
      }
    };
  }, [game, launchOptions, persistLaunchOptions, visible]);

  const execPickerFilters = useMemo(
    () =>
      getGameExecutableFilters(globalThis.window.electron.platform, {
        executable: t("game_executable"),
        allFiles: t("all_files"),
      }),
    [t]
  );

  const assetPickerFilters = useMemo<FileFilter[]>(
    () => [
      {
        name: t("edit_game_modal_image_filter", { ns: "sidebar" }),
        extensions: [...IMAGE_FILE_EXTENSIONS],
      },
    ],
    [t]
  );

  const handleProcessExecPath = useCallback(
    async (path: string) => {
      if (!game) return;

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
    },
    [game, showErrorToast, t, updateGame]
  );

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

  const executeSteamShortcutAction = useCallback(
    async (
      action: () => Promise<void>,
      successMessage: string,
      errorMessage: string,
      nextSteamShortcutExists: boolean
    ) => {
      if (!game) return;

      await runSharedSteamShortcutAction({
        action,
        setLoading: setCreatingSteamShortcut,
        setExists: setSteamShortcutExists,
        nextExists: nextSteamShortcutExists,
        updateGame,
        showSuccessToast,
        showErrorToast,
        successMessage,
        errorMessage,
        restartMessage: t("you_might_need_to_restart_steam"),
      });
    },
    [game, showErrorToast, showSuccessToast, t, updateGame]
  );

  const handleCreateSteamShortcut = useCallback(async () => {
    if (!game || game.shop === "custom") return;

    await executeSteamShortcutAction(
      () =>
        globalThis.window.electron.createSteamShortcut(
          game.shop,
          game.objectId
        ),
      t("create_shortcut_success"),
      t("create_shortcut_error"),
      true
    );
  }, [executeSteamShortcutAction, game, t]);

  const handleDeleteSteamShortcut = useCallback(async () => {
    if (!game || game.shop === "custom") return;

    await executeSteamShortcutAction(
      () =>
        globalThis.window.electron.deleteSteamShortcut(
          game.shop,
          game.objectId
        ),
      t("delete_shortcut_success"),
      t("delete_shortcut_error"),
      false
    );
  }, [executeSteamShortcutAction, game, t]);

  const handleClearLaunchOptions = useCallback(() => {
    setLaunchOptions("");
  }, []);

  const handleBlurLaunchOptions = useCallback(() => {
    persistLaunchOptions(launchOptions).catch(() => {});
  }, [launchOptions, persistLaunchOptions]);

  const updateClassicsDisc = useCallback(
    async (
      payload: ClassicsDiscUpdatePayload,
      options?: { skipRefresh?: boolean }
    ) => {
      if (!game) return;

      await applyClassicsDiscUpdate(game, payload, updateGame, options);
    },
    [game, updateGame]
  );

  const handleSelectDisc = useCallback(
    async (discPath: string) => {
      await updateClassicsDisc({
        selectedDiscPath: discPath,
      });
    },
    [updateClassicsDisc]
  );

  const handleToggleDontAskDiscSelection = useCallback(
    async (checked: boolean) => {
      await updateClassicsDisc({
        dontAskDiscSelection: checked,
      });
    },
    [updateClassicsDisc]
  );

  const addDiscFromPath = useCallback(
    async (fullPath: string) => {
      if (!game) return;

      await updateClassicsDisc(
        buildAddedDiscPayload(fullPath, game.discs?.length ?? 0)
      );
    },
    [game, updateClassicsDisc]
  );

  const handleProcessDiscPath = useCallback(
    async (path: string) => {
      await addDiscFromPath(path);
    },
    [addDiscFromPath]
  );

  const handleRemoveSelectedDisc = useCallback(async () => {
    if (!game || !selectedDisc) return;

    await updateClassicsDisc({
      removeDiscPath: selectedDisc.path,
    });
  }, [game, selectedDisc, updateClassicsDisc]);

  const handleRemoveAllDiscs = useCallback(async () => {
    if (!game) return;

    const discsToRemove = game.discs ?? [];
    if (discsToRemove.length === 0) return;

    for (const disc of discsToRemove) {
      await updateClassicsDisc(
        {
          removeDiscPath: disc.path,
        },
        { skipRefresh: true }
      );
    }

    await updateGame();
  }, [game, updateClassicsDisc, updateGame]);

  const handleToggleAutomaticCloudSync = useCallback(
    async (checked: boolean) => {
      if (!game) return;
      setAutomaticCloudSync(checked);
      try {
        await globalThis.window.electron.toggleAutomaticCloudSync(
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
      execPickerInitialPath,
      execPickerFilters,
      discPickerFilters,
      onProcessExecPath: handleProcessExecPath,
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
      onProcessDiscPath: handleProcessDiscPath,
      onRemoveSelectedDisc: handleRemoveSelectedDisc,
      onRemoveAllDiscs: handleRemoveAllDiscs,
    } satisfies GameLaunchSettingsProps;
  }, [
    creatingSteamShortcut,
    discPickerFilters,
    execPickerFilters,
    execPickerInitialPath,
    game,
    handleBlurLaunchOptions,
    handleProcessExecPath,
    handleClearExecutablePath,
    handleClearLaunchOptions,
    handleCreateShortcut,
    handleCreateSteamShortcut,
    handleDeleteSteamShortcut,
    handleOpenSaveFolder,
    handleProcessDiscPath,
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
      assetPickerFilters,
      onChangeGameTitle: handleChangeGameTitle,
      onBlurGameTitle: handleBlurGameTitle,
      onProcessAssetPath: handleProcessAssetPath,
      onClearAsset: handleClearCustomizationAsset,
      onArtworkChanged: refreshGameDetails,
    } satisfies GameCustomizationSettingsProps;
  }, [
    game,
    gameTitle,
    assetPickerFilters,
    handleBlurGameTitle,
    handleChangeGameTitle,
    handleClearCustomizationAsset,
    handleProcessAssetPath,
    refreshGameDetails,
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
