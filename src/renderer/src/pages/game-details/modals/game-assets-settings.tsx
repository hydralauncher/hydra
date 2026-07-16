import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  AlertIcon,
  CloudOfflineIcon,
  ImageIcon,
  PencilIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { Button, ImageCropModal } from "@renderer/components";
import { useToast, useAppSelector, useUserDetails } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { generateRandomGradient } from "@renderer/helpers";
import type { Game, LibraryGame, ShopDetailsWithAssets } from "@types";

import { GameArtworkPicker } from "./game-artwork-picker";

import "./game-assets-settings.scss";

type AssetType = "icon" | "logo" | "hero" | "grid";

const ASSET_OUTPUT_SIZE: Record<AssetType, { width: number; height: number }> =
  {
    icon: { width: 256, height: 256 },
    logo: { width: 640, height: 360 },
    hero: { width: 1920, height: 620 },
    grid: { width: 600, height: 900 },
  };

const PREVIEW_MODIFIER_CLASS: Partial<Record<AssetType, string>> = {
  icon: "game-assets-settings__icon-preview",
  grid: "game-assets-settings__cover-preview",
};

interface ElectronFile extends File {
  path?: string;
}

interface GameWithOriginalAssets extends Game {
  originalIconPath?: string;
  originalLogoPath?: string;
  originalHeroPath?: string;
}

interface LibraryGameWithCustomOriginalAssets extends LibraryGame {
  customOriginalIconPath?: string;
  customOriginalLogoPath?: string;
  customOriginalHeroPath?: string;
  customOriginalCoverPath?: string;
}

interface AssetPaths {
  icon: string;
  logo: string;
  hero: string;
  grid: string;
}

interface AssetUrls {
  icon: string | null;
  logo: string | null;
  hero: string | null;
  grid: string | null;
}

interface RemovedAssets {
  icon: boolean;
  logo: boolean;
  hero: boolean;
  grid: boolean;
}

interface PendingAssetCrop {
  assetType: AssetType;
  sourcePath: string;
  displayPath: string;
  cleanupSource: boolean;
  artworkId?: number;
}

interface PendingArtworkSelection {
  assetType: AssetType;
  artworkId: number | null;
}

const VALID_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/apng",
  "image/gif",
  "image/webp",
] as const;

const IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "jfif",
  "png",
  "apng",
  "gif",
  "webp",
] as const;

const INITIAL_ASSET_PATHS: AssetPaths = {
  icon: "",
  logo: "",
  hero: "",
  grid: "",
};

const INITIAL_REMOVED_ASSETS: RemovedAssets = {
  icon: false,
  logo: false,
  hero: false,
  grid: false,
};

const INITIAL_ASSET_URLS: AssetUrls = {
  icon: null,
  logo: null,
  hero: null,
  grid: null,
};

const preloadImage = (url: string) =>
  new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
  });

const getCustomAssetUrl = (
  removed: boolean,
  assetPath: string,
  currentUrl: string | null | undefined
) => {
  if (removed) return null;
  if (assetPath) return `local:${assetPath}`;

  return currentUrl;
};

const getCustomHeroImageUrl = (
  removed: boolean,
  assetPath: string,
  currentUrl: string | null | undefined
) => {
  if (!removed) {
    return getCustomAssetUrl(false, assetPath, currentUrl);
  }

  if (currentUrl?.startsWith("data:image/svg+xml")) {
    return currentUrl;
  }

  return generateRandomGradient();
};

const getGameCustomAssetUrl = (
  game: LibraryGame,
  assetType: AssetType
): string | null | undefined => {
  const isCustomGame = game.shop === "custom";

  if (assetType === "icon") {
    return isCustomGame ? game.iconUrl : game.customIconUrl;
  }

  if (assetType === "logo") {
    return isCustomGame ? game.logoImageUrl : game.customLogoImageUrl;
  }

  if (assetType === "hero") {
    return isCustomGame ? game.libraryHeroImageUrl : game.customHeroImageUrl;
  }

  return game.customCoverImageUrl;
};

export interface GameAssetsSettingsProps {
  game: LibraryGame;
  shopDetails: ShopDetailsWithAssets | null;
  onGameUpdated: () => Promise<void> | void;
}

export function GameAssetsSettings({
  game,
  shopDetails,
  onGameUpdated,
}: Readonly<GameAssetsSettingsProps>) {
  const { t } = useTranslation("sidebar");
  const { t: tProfile } = useTranslation("user_profile");
  const { showSuccessToast, showErrorToast } = useToast();
  const { hasActiveSubscription } = useUserDetails();
  const { showHydraCloudModal } = useSubscription();
  const navigate = useNavigate();
  const classicsUseHeroLayout =
    useAppSelector(
      (state) => state.userPreferences.value?.classicsUseHeroLayout
    ) ?? false;

  const [assetPaths, setAssetPaths] = useState<AssetPaths>(INITIAL_ASSET_PATHS);
  const [originalAssetPaths, setOriginalAssetPaths] =
    useState<AssetPaths>(INITIAL_ASSET_PATHS);
  const [removedAssets, setRemovedAssets] = useState<RemovedAssets>(
    INITIAL_REMOVED_ASSETS
  );
  const [defaultUrls, setDefaultUrls] = useState<AssetUrls>(INITIAL_ASSET_URLS);
  const [isUpdating, setIsUpdating] = useState(false);
  const [pendingUpdateMessage, setPendingUpdateMessage] = useState<
    string | null
  >(null);
  const [selectedAssetType, setSelectedAssetType] = useState<AssetType>("icon");
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [pendingAssetCrop, setPendingAssetCrop] =
    useState<PendingAssetCrop | null>(null);
  const [pendingArtworkSelection, setPendingArtworkSelection] =
    useState<PendingArtworkSelection | null>(null);
  const [pendingPreloadUrl, setPendingPreloadUrl] = useState<string | null>(
    null
  );
  const [isPreparingAsset, setIsPreparingAsset] = useState(false);
  const [artworkPickerVersion, setArtworkPickerVersion] = useState(0);

  const mountedRef = useRef(true);
  const assetFlowBusyRef = useRef(false);
  const pendingAssetCropRef = useRef<PendingAssetCrop | null>(null);

  const cleanupTempFile = useCallback(async (filePath: string) => {
    try {
      await window.electron.deleteTempFile(filePath);
    } catch (error) {
      console.warn(`Failed to clean up temporary file ${filePath}:`, error);
    }
  }, []);

  const beginAssetFlow = useCallback(() => {
    if (assetFlowBusyRef.current) return false;

    assetFlowBusyRef.current = true;
    setIsPreparingAsset(true);
    return true;
  }, []);

  const releaseAssetFlow = useCallback(() => {
    assetFlowBusyRef.current = false;

    if (mountedRef.current) {
      setIsPreparingAsset(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      const pendingCrop = pendingAssetCropRef.current;
      pendingAssetCropRef.current = null;

      if (pendingCrop?.cleanupSource) {
        cleanupTempFile(pendingCrop.sourcePath).catch(() => {});
      }
    };
  }, [cleanupTempFile]);

  const isCustomGame = useCallback(
    (currentGame: LibraryGame | Game): boolean => {
      return currentGame.shop === "custom";
    },
    []
  );

  const extractLocalPath = useCallback(
    (url: string | null | undefined): string => {
      return url?.startsWith("local:") ? url.replace("local:", "") : "";
    },
    []
  );

  const setCustomGameAssets = useCallback(
    (currentGame: LibraryGame | Game) => {
      const gameWithAssets = currentGame as GameWithOriginalAssets;
      const iconRemoved =
        !currentGame.iconUrl && Boolean(gameWithAssets.originalIconPath);
      const logoRemoved =
        !currentGame.logoImageUrl && Boolean(gameWithAssets.originalLogoPath);
      const heroRemoved =
        !currentGame.libraryHeroImageUrl &&
        Boolean(gameWithAssets.originalHeroPath);

      setAssetPaths({
        icon: extractLocalPath(currentGame.iconUrl),
        logo: extractLocalPath(currentGame.logoImageUrl),
        hero: extractLocalPath(currentGame.libraryHeroImageUrl),
        grid: "",
      });
      setOriginalAssetPaths({
        icon:
          gameWithAssets.originalIconPath ||
          extractLocalPath(currentGame.iconUrl),
        logo:
          gameWithAssets.originalLogoPath ||
          extractLocalPath(currentGame.logoImageUrl),
        hero:
          gameWithAssets.originalHeroPath ||
          extractLocalPath(currentGame.libraryHeroImageUrl),
        grid: "",
      });

      setRemovedAssets({
        icon: iconRemoved,
        logo: logoRemoved,
        hero: heroRemoved,
        grid: false,
      });
    },
    [extractLocalPath]
  );

  const setNonCustomGameAssets = useCallback(
    (currentGame: LibraryGame) => {
      const gameWithAssets = currentGame as LibraryGameWithCustomOriginalAssets;
      const iconRemoved =
        !currentGame.customIconUrl &&
        Boolean(gameWithAssets.customOriginalIconPath);
      const logoRemoved =
        !currentGame.customLogoImageUrl &&
        Boolean(gameWithAssets.customOriginalLogoPath);
      const heroRemoved =
        !currentGame.customHeroImageUrl &&
        Boolean(gameWithAssets.customOriginalHeroPath);
      const gridRemoved =
        !currentGame.customCoverImageUrl &&
        Boolean(gameWithAssets.customOriginalCoverPath);

      setAssetPaths({
        icon: extractLocalPath(currentGame.customIconUrl),
        logo: extractLocalPath(currentGame.customLogoImageUrl),
        hero: extractLocalPath(currentGame.customHeroImageUrl),
        grid: extractLocalPath(currentGame.customCoverImageUrl),
      });
      setOriginalAssetPaths({
        icon:
          gameWithAssets.customOriginalIconPath ||
          extractLocalPath(currentGame.customIconUrl),
        logo:
          gameWithAssets.customOriginalLogoPath ||
          extractLocalPath(currentGame.customLogoImageUrl),
        hero:
          gameWithAssets.customOriginalHeroPath ||
          extractLocalPath(currentGame.customHeroImageUrl),
        grid:
          gameWithAssets.customOriginalCoverPath ||
          extractLocalPath(currentGame.customCoverImageUrl),
      });

      setRemovedAssets({
        icon: iconRemoved,
        logo: logoRemoved,
        hero: heroRemoved,
        grid: gridRemoved,
      });

      setDefaultUrls({
        icon: shopDetails?.assets?.iconUrl || currentGame.iconUrl || null,
        logo:
          shopDetails?.assets?.logoImageUrl || currentGame.logoImageUrl || null,
        hero:
          shopDetails?.assets?.libraryHeroImageUrl ||
          currentGame.libraryHeroImageUrl ||
          null,
        grid:
          shopDetails?.assets?.coverImageUrl ||
          currentGame.coverImageUrl ||
          shopDetails?.assets?.libraryImageUrl ||
          currentGame.libraryImageUrl ||
          shopDetails?.assets?.iconUrl ||
          currentGame.iconUrl ||
          null,
      });
    },
    [extractLocalPath, shopDetails]
  );

  useEffect(() => {
    setRemovedAssets(INITIAL_REMOVED_ASSETS);
    setAssetPaths(INITIAL_ASSET_PATHS);
    setOriginalAssetPaths(INITIAL_ASSET_PATHS);

    if (isCustomGame(game)) {
      setCustomGameAssets(game);
      setDefaultUrls(INITIAL_ASSET_URLS);
    } else {
      setNonCustomGameAssets(game);
    }
  }, [game, isCustomGame, setCustomGameAssets, setNonCustomGameAssets]);

  useEffect(() => {
    if (game.shop === "custom") return;

    let cancelled = false;

    window.electron
      .getGameAssets(game.objectId, game.shop)
      .then((assets) => {
        if (cancelled || !assets) return;

        setDefaultUrls((previous) => ({
          icon: assets.iconUrl || previous.icon,
          logo: assets.logoImageUrl || previous.logo,
          hero: assets.libraryHeroImageUrl || previous.hero,
          grid: assets.coverImageUrl || assets.libraryImageUrl || previous.grid,
        }));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [game.objectId, game.shop]);

  const handleAssetTypeChange = (assetType: AssetType) => {
    if (assetFlowBusyRef.current) return;
    setSelectedAssetType(assetType);
  };

  const updateAssetPaths = (
    assetType: AssetType,
    path: string,
    displayPath: string
  ): void => {
    setAssetPaths((prev) => ({ ...prev, [assetType]: path }));
    setOriginalAssetPaths((prev) => ({ ...prev, [assetType]: displayPath }));
    setRemovedAssets((prev) => ({ ...prev, [assetType]: false }));
  };

  const handleRestoreDefault = (assetType: AssetType) => {
    if (!beginAssetFlow()) return;

    setRemovedAssets((prev) => ({ ...prev, [assetType]: true }));
    setAssetPaths((prev) => ({ ...prev, [assetType]: "" }));
    setPendingArtworkSelection({ assetType, artworkId: null });
    setPendingPreloadUrl(defaultUrls[assetType]);
    setPendingUpdateMessage(t("steamgriddb_artwork_reset"));
  };

  const openAssetCrop = (
    assetType: AssetType,
    sourcePath: string,
    displayPath = sourcePath,
    cleanupSource = false,
    artworkId?: number
  ) => {
    const pendingCrop = {
      assetType,
      sourcePath,
      displayPath,
      cleanupSource,
      artworkId,
    };

    pendingAssetCropRef.current = pendingCrop;
    setPendingAssetCrop(pendingCrop);
    setIsPreparingAsset(false);
  };

  const applyUncroppedAsset = async (
    assetType: AssetType,
    sourcePath: string,
    displayPath = sourcePath,
    cleanupSource = false
  ) => {
    try {
      const copiedAssetUrl = await window.electron.copyCustomGameAsset(
        sourcePath,
        assetType
      );

      updateAssetPaths(
        assetType,
        copiedAssetUrl.replace("local:", ""),
        displayPath
      );
      setPendingArtworkSelection({ assetType, artworkId: null });
      setPendingPreloadUrl(copiedAssetUrl);
      setPendingUpdateMessage(t("steamgriddb_artwork_updated"));
    } finally {
      if (cleanupSource) {
        await cleanupTempFile(sourcePath);
      }
    }
  };

  const prepareLocalAsset = async (
    assetType: AssetType,
    sourcePath: string,
    displayPath = sourcePath,
    cleanupSource = false
  ) => {
    let isAnimated = true;

    try {
      const metadata =
        await window.electron.getProfileImageMetadata(sourcePath);
      isAnimated = metadata.isAnimated;
    } catch {
      isAnimated = true;
    }

    if (!mountedRef.current) {
      if (cleanupSource) {
        await cleanupTempFile(sourcePath);
      }
      releaseAssetFlow();
      return;
    }

    if (isAnimated) {
      await applyUncroppedAsset(
        assetType,
        sourcePath,
        displayPath,
        cleanupSource
      );
      return;
    }

    openAssetCrop(assetType, sourcePath, displayPath, cleanupSource);
  };

  const handleSelectAsset = async (assetType: AssetType) => {
    if (!beginAssetFlow()) return;

    try {
      const { filePaths } = await window.electron.showOpenDialog({
        properties: ["openFile"],
        filters: [
          {
            name: t("edit_game_modal_image_filter"),
            extensions: [...IMAGE_EXTENSIONS],
          },
        ],
      });

      if (filePaths && filePaths.length > 0) {
        if (mountedRef.current) {
          await prepareLocalAsset(assetType, filePaths[0]);
        } else {
          releaseAssetFlow();
        }
      } else {
        releaseAssetFlow();
      }
    } catch (error) {
      releaseAssetFlow();
      console.error(`Failed to select ${assetType}:`, error);
      showErrorToast(tProfile("image_process_failure"));
    }
  };

  const handleSelectSteamGridDbArtwork = async (
    assetType: AssetType,
    artworkUrl: string,
    artworkId: number
  ): Promise<boolean> => {
    if (!beginAssetFlow()) return false;

    try {
      const tempPath = await window.electron.downloadGameArtwork(artworkUrl);

      if (!tempPath) {
        releaseAssetFlow();
        return true;
      }

      if (!mountedRef.current) {
        await cleanupTempFile(tempPath);
        releaseAssetFlow();
        return false;
      }

      openAssetCrop(assetType, tempPath, artworkUrl, true, artworkId);
      return false;
    } catch (error) {
      releaseAssetFlow();
      throw error;
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragEnter = (event: React.DragEvent, target: string) => {
    event.preventDefault();
    event.stopPropagation();

    if (assetFlowBusyRef.current) return;
    setDragOverTarget(target);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDragOverTarget(null);
    }
  };

  const validateImageFile = (file: File): boolean => {
    const hasValidMimeType = VALID_IMAGE_TYPES.includes(
      file.type.toLowerCase() as (typeof VALID_IMAGE_TYPES)[number]
    );
    const extension = file.name.split(".").pop()?.toLowerCase();

    return (
      hasValidMimeType ||
      IMAGE_EXTENSIONS.includes(extension as (typeof IMAGE_EXTENSIONS)[number])
    );
  };

  const processDroppedFile = async (file: File, assetType: AssetType) => {
    setDragOverTarget(null);

    if (!validateImageFile(file)) {
      showErrorToast(tProfile("image_process_failure"));
      releaseAssetFlow();
      return;
    }

    try {
      let filePath: string;
      let cleanupSource = false;

      if ("path" in file && typeof (file as ElectronFile).path === "string") {
        filePath = (file as ElectronFile).path!;
      } else {
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        const tempFileName = `temp_${Date.now()}_${file.name}`;
        const tempPath = await window.electron.saveTempFile?.(
          tempFileName,
          uint8Array
        );

        if (!tempPath) {
          throw new Error(
            "Unable to process file. Drag and drop may not be fully supported."
          );
        }

        filePath = tempPath;
        cleanupSource = true;
      }

      if (!mountedRef.current) {
        if (cleanupSource) {
          await cleanupTempFile(filePath);
        }
        releaseAssetFlow();
        return;
      }

      await prepareLocalAsset(assetType, filePath, filePath, cleanupSource);
    } catch (error) {
      releaseAssetFlow();
      console.error(`Failed to process dropped ${assetType}:`, error);
      showErrorToast(tProfile("image_process_failure"));
    }
  };

  const handleAssetDrop = async (
    event: React.DragEvent,
    assetType: AssetType
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverTarget(null);

    if (!beginAssetFlow()) return;

    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      await processDroppedFile(files[0], assetType);
    } else {
      releaseAssetFlow();
    }
  };

  const handleCloseCrop = () => {
    const pendingCrop = pendingAssetCrop;
    pendingAssetCropRef.current = null;
    setPendingAssetCrop(null);

    if (pendingCrop?.cleanupSource) {
      cleanupTempFile(pendingCrop.sourcePath).catch(() => {});
    }

    releaseAssetFlow();
  };

  const handleApplyCrop = async (croppedImagePath: string) => {
    const pendingCrop = pendingAssetCrop;
    if (!pendingCrop) return;

    let copiedSuccessfully = false;

    try {
      const copiedAssetUrl = await window.electron.copyCustomGameAsset(
        croppedImagePath,
        pendingCrop.assetType
      );

      updateAssetPaths(
        pendingCrop.assetType,
        copiedAssetUrl.replace("local:", ""),
        pendingCrop.displayPath
      );
      setPendingArtworkSelection({
        assetType: pendingCrop.assetType,
        artworkId: pendingCrop.artworkId ?? null,
      });
      setPendingPreloadUrl(copiedAssetUrl);
      setPendingUpdateMessage(t("steamgriddb_artwork_updated"));
      pendingAssetCropRef.current = null;
      setPendingAssetCrop(null);
      setIsPreparingAsset(true);
      copiedSuccessfully = true;
    } finally {
      await cleanupTempFile(croppedImagePath);

      if (copiedSuccessfully && pendingCrop.cleanupSource) {
        await cleanupTempFile(pendingCrop.sourcePath);
      }
    }
  };

  const prepareCustomGameAssets = useCallback(
    (currentGame: LibraryGame | Game) => {
      const iconUrl = getCustomAssetUrl(
        removedAssets.icon,
        assetPaths.icon,
        currentGame.iconUrl
      );
      const logoImageUrl = getCustomAssetUrl(
        removedAssets.logo,
        assetPaths.logo,
        currentGame.logoImageUrl
      );
      const libraryHeroImageUrl = getCustomHeroImageUrl(
        removedAssets.hero,
        assetPaths.hero,
        currentGame.libraryHeroImageUrl
      );

      return { iconUrl, logoImageUrl, libraryHeroImageUrl };
    },
    [assetPaths, removedAssets]
  );

  const prepareNonCustomGameAssets = useCallback(
    (currentGame: LibraryGame) => {
      const customIconUrl = getCustomAssetUrl(
        removedAssets.icon,
        assetPaths.icon,
        currentGame.customIconUrl
      );
      const customLogoImageUrl = getCustomAssetUrl(
        removedAssets.logo,
        assetPaths.logo,
        currentGame.customLogoImageUrl
      );
      const customHeroImageUrl = getCustomAssetUrl(
        removedAssets.hero,
        assetPaths.hero,
        currentGame.customHeroImageUrl
      );
      const customCoverImageUrl = getCustomAssetUrl(
        removedAssets.grid,
        assetPaths.grid,
        currentGame.customCoverImageUrl
      );

      return {
        customIconUrl,
        customLogoImageUrl,
        customHeroImageUrl,
        customCoverImageUrl,
      };
    },
    [assetPaths, removedAssets]
  );

  const updateCustomGame = useCallback(
    async (currentGame: LibraryGame | Game) => {
      const { iconUrl, logoImageUrl, libraryHeroImageUrl } =
        prepareCustomGameAssets(currentGame);

      return window.electron.updateCustomGame({
        shop: currentGame.shop,
        objectId: currentGame.objectId,
        title: game.title,
        iconUrl: iconUrl || undefined,
        logoImageUrl: logoImageUrl || undefined,
        libraryHeroImageUrl: libraryHeroImageUrl || undefined,
        originalIconPath: originalAssetPaths.icon || undefined,
        originalLogoPath: originalAssetPaths.logo || undefined,
        originalHeroPath: originalAssetPaths.hero || undefined,
      });
    },
    [game.title, originalAssetPaths, prepareCustomGameAssets]
  );

  const updateNonCustomGame = useCallback(
    async (currentGame: LibraryGame) => {
      const {
        customIconUrl,
        customLogoImageUrl,
        customHeroImageUrl,
        customCoverImageUrl,
      } = prepareNonCustomGameAssets(currentGame);

      return window.electron.updateGameCustomAssets({
        shop: currentGame.shop,
        objectId: currentGame.objectId,
        title: game.title,
        customIconUrl,
        customLogoImageUrl,
        customHeroImageUrl,
        customCoverImageUrl,
        customOriginalIconPath: removedAssets.icon
          ? undefined
          : originalAssetPaths.icon || undefined,
        customOriginalLogoPath: removedAssets.logo
          ? undefined
          : originalAssetPaths.logo || undefined,
        customOriginalHeroPath: removedAssets.hero
          ? undefined
          : originalAssetPaths.hero || undefined,
        customOriginalCoverPath: removedAssets.grid
          ? undefined
          : originalAssetPaths.grid || undefined,
        customArtworkIds: pendingArtworkSelection
          ? {
              [pendingArtworkSelection.assetType]:
                pendingArtworkSelection.artworkId,
            }
          : undefined,
        clearArtworkTypes:
          pendingArtworkSelection?.artworkId === null
            ? [pendingArtworkSelection.assetType]
            : undefined,
      });
    },
    [
      game.title,
      originalAssetPaths,
      pendingArtworkSelection,
      prepareNonCustomGameAssets,
      removedAssets,
    ]
  );

  useEffect(() => {
    if (!pendingUpdateMessage || isUpdating) return;

    setIsUpdating(true);

    const updateGameAssets = async () => {
      let assetsUpdated = false;

      try {
        await (isCustomGame(game)
          ? updateCustomGame(game)
          : updateNonCustomGame(game as LibraryGame));

        assetsUpdated = true;
        await onGameUpdated();

        if (pendingPreloadUrl) {
          await preloadImage(pendingPreloadUrl);
        }

        showSuccessToast(pendingUpdateMessage || t("edit_game_modal_success"));
      } catch (error) {
        console.error("Failed to update game:", error);
        showErrorToast(
          error instanceof Error ? error.message : t("edit_game_modal_failed")
        );
      } finally {
        if (assetsUpdated) {
          setArtworkPickerVersion((version) => version + 1);
        }

        setPendingArtworkSelection(null);
        setPendingPreloadUrl(null);
        setPendingUpdateMessage(null);
        setIsUpdating(false);
        releaseAssetFlow();
      }
    };

    updateGameAssets().catch(() => {});
  }, [
    game,
    isCustomGame,
    isUpdating,
    onGameUpdated,
    pendingPreloadUrl,
    pendingUpdateMessage,
    releaseAssetFlow,
    showErrorToast,
    showSuccessToast,
    t,
    updateCustomGame,
    updateNonCustomGame,
  ]);

  const isAssetFlowBusy =
    isUpdating || isPreparingAsset || pendingAssetCrop !== null;

  const getPreviewUrl = (assetType: AssetType): string | undefined => {
    const assetPath = assetPaths[assetType];
    const defaultUrl = defaultUrls[assetType];
    const customAssetUrl = getGameCustomAssetUrl(game, assetType);

    if (assetPath) {
      return `local:${assetPath}`;
    }

    if (!removedAssets[assetType] && customAssetUrl) {
      return customAssetUrl;
    }

    return isCustomGame(game) ? undefined : defaultUrl || undefined;
  };

  const renderImageSection = (assetType: AssetType) => {
    const assetPath = assetPaths[assetType];
    const customAssetUrl = getGameCustomAssetUrl(game, assetType);
    const hasCustomAsset =
      !removedAssets[assetType] && Boolean(assetPath || customAssetUrl);
    const previewUrl = getPreviewUrl(assetType);
    const hasImage = Boolean(previewUrl);
    const isDragOver = dragOverTarget === assetType;

    const getTranslationKey = (suffix: string) =>
      `edit_game_modal_${assetType}${suffix}`;

    return (
      <div className="game-assets-settings__image-section">
        {hasImage ? (
          <button
            type="button"
            aria-label={
              hasCustomAsset
                ? t("steamgriddb_use_default")
                : t(`edit_game_modal_select_${assetType}`)
            }
            className={`game-assets-settings__image-preview ${
              PREVIEW_MODIFIER_CLASS[assetType] ?? ""
            } ${isDragOver ? "game-assets-settings__drop-zone--active" : ""}`}
            onDragOver={handleDragOver}
            onDragEnter={(event) => handleDragEnter(event, assetType)}
            onDragLeave={handleDragLeave}
            onDrop={(event) => handleAssetDrop(event, assetType)}
            onClick={() =>
              hasCustomAsset
                ? handleRestoreDefault(assetType)
                : handleSelectAsset(assetType)
            }
            disabled={isAssetFlowBusy}
          >
            <img
              src={previewUrl}
              alt={t(getTranslationKey("_preview"))}
              className="game-assets-settings__preview-image"
            />
            <span
              className="game-assets-settings__preview-action-overlay"
              aria-hidden="true"
            >
              <span
                className={`game-assets-settings__preview-action-icon ${
                  hasCustomAsset
                    ? "game-assets-settings__preview-action-icon--danger"
                    : ""
                }`}
              >
                {hasCustomAsset ? (
                  <TrashIcon size={20} />
                ) : (
                  <PencilIcon size={20} />
                )}
              </span>
            </span>
            {isDragOver && (
              <div className="game-assets-settings__drop-overlay">
                <span>{t(`edit_game_modal_drop_to_replace_${assetType}`)}</span>
              </div>
            )}
          </button>
        ) : (
          <button
            type="button"
            aria-label={t(getTranslationKey("_drop_zone_empty"))}
            className={`game-assets-settings__image-preview ${
              PREVIEW_MODIFIER_CLASS[assetType] ?? ""
            } game-assets-settings__drop-zone ${
              isDragOver ? "game-assets-settings__drop-zone--active" : ""
            }`}
            onDragOver={handleDragOver}
            onDragEnter={(event) => handleDragEnter(event, assetType)}
            onDragLeave={handleDragLeave}
            onDrop={(event) => handleAssetDrop(event, assetType)}
            onClick={() => handleSelectAsset(assetType)}
            disabled={isAssetFlowBusy}
          >
            <div className="game-assets-settings__drop-zone-content">
              <ImageIcon />
              <span>{t(`edit_game_modal_drop_${assetType}_image_here`)}</span>
            </div>
          </button>
        )}
      </div>
    );
  };

  const assetTabs = (
    [
      { type: "icon", labelKey: "edit_game_modal_icon" },
      { type: "logo", labelKey: "edit_game_modal_logo" },
      { type: "hero", labelKey: "edit_game_modal_hero" },
      { type: "grid", labelKey: "edit_game_modal_grid" },
    ] as const
  ).filter((tab) => tab.type !== "grid" || !isCustomGame(game));

  return (
    <>
      {pendingAssetCrop && (
        <ImageCropModal
          visible
          imagePath={pendingAssetCrop.sourcePath}
          outputWidth={ASSET_OUTPUT_SIZE[pendingAssetCrop.assetType].width}
          outputHeight={ASSET_OUTPUT_SIZE[pendingAssetCrop.assetType].height}
          preserveSourceAspectRatio={pendingAssetCrop.assetType === "logo"}
          title={t(`edit_game_modal_${pendingAssetCrop.assetType}`)}
          description={tProfile("crop_profile_image_description")}
          stageLabel={t(`edit_game_modal_${pendingAssetCrop.assetType}`)}
          errorMessage={tProfile("image_process_failure")}
          labels={{
            apply: tProfile("apply_crop"),
            applying: tProfile("applying_crop"),
            cancel: tProfile("cancel"),
            reset: tProfile("reset"),
            rotate: tProfile("rotate"),
            toggleGrid: tProfile("toggle_grid"),
            zoom: tProfile("zoom"),
            zoomIn: tProfile("zoom_in"),
            zoomOut: tProfile("zoom_out"),
          }}
          onClose={handleCloseCrop}
          onApply={handleApplyCrop}
        />
      )}

      <div className="game-assets-settings">
        {!hasActiveSubscription && !isCustomGame(game) && (
          <button
            type="button"
            className="subscription-required-button"
            onClick={() => showHydraCloudModal("customization")}
          >
            <CloudOfflineIcon size={16} />
            <span>{t("custom_assets_not_sync")}</span>
          </button>
        )}

        <div className="game-assets-settings__asset-tabs">
          {assetTabs.map((tab) => (
            <button
              key={tab.type}
              type="button"
              className={`game-assets-settings__asset-tab ${
                selectedAssetType === tab.type
                  ? "game-assets-settings__asset-tab--active"
                  : ""
              }`}
              onClick={() => handleAssetTypeChange(tab.type)}
              disabled={isAssetFlowBusy}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {game.shop === "launchbox" &&
          !classicsUseHeroLayout &&
          (selectedAssetType === "hero" || selectedAssetType === "logo") && (
            <div className="game-assets-settings__warning">
              <AlertIcon
                size={16}
                className="game-assets-settings__warning-icon"
              />
              <span className="game-assets-settings__warning-text">
                {t("classics_hero_layout_warning")}
              </span>
              <Button
                type="button"
                theme="outline"
                onClick={() => navigate("/settings?tab=content_gameplay")}
              >
                {t("classics_hero_layout_open_settings")}
              </Button>
            </div>
          )}

        {renderImageSection(selectedAssetType)}

        {!isCustomGame(game) && (
          <GameArtworkPicker
            key={`${game.shop}:${game.objectId}:${selectedAssetType}`}
            game={game}
            assetType={selectedAssetType}
            onChanged={onGameUpdated}
            disabled={isAssetFlowBusy}
            selectionVersion={artworkPickerVersion}
            onSelectArtwork={({ artworkUrl, artworkId }) =>
              handleSelectSteamGridDbArtwork(
                selectedAssetType,
                artworkUrl,
                artworkId
              )
            }
          />
        )}
      </div>
    </>
  );
}
