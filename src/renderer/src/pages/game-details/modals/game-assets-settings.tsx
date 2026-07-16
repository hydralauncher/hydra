import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  AlertIcon,
  CloudOfflineIcon,
  ImageIcon,
  XIcon,
} from "@primer/octicons-react";
import {
  Button,
  ImageCropModal,
  TextField,
  type ImageCropResult,
} from "@renderer/components";
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
  const { showSuccessToast, showErrorToast, showWarningToast } = useToast();
  const { hasActiveSubscription } = useUserDetails();
  const { showHydraCloudModal } = useSubscription();
  const navigate = useNavigate();
  const classicsUseHeroLayout =
    useAppSelector(
      (state) => state.userPreferences.value?.classicsUseHeroLayout
    ) ?? false;

  const [assetPaths, setAssetPaths] = useState<AssetPaths>(INITIAL_ASSET_PATHS);
  const [assetDisplayPaths, setAssetDisplayPaths] =
    useState<AssetPaths>(INITIAL_ASSET_PATHS);
  const [originalAssetPaths, setOriginalAssetPaths] =
    useState<AssetPaths>(INITIAL_ASSET_PATHS);
  const [removedAssets, setRemovedAssets] = useState<RemovedAssets>(
    INITIAL_REMOVED_ASSETS
  );
  const [defaultUrls, setDefaultUrls] = useState<AssetUrls>(INITIAL_ASSET_URLS);
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedAssetType, setSelectedAssetType] = useState<AssetType>("icon");
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [pendingAssetCrop, setPendingAssetCrop] =
    useState<PendingAssetCrop | null>(null);
  const [isPreparingAsset, setIsPreparingAsset] = useState(false);

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

  const getAssetValue = useCallback(
    (url: string | null | undefined) => url ?? "",
    []
  );

  const getDisplayPath = useCallback((url: string | null | undefined) => {
    if (!url) return "";
    return url.startsWith("local:") ? url.slice("local:".length) : url;
  }, []);

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
        icon: getAssetValue(currentGame.iconUrl),
        logo: getAssetValue(currentGame.logoImageUrl),
        hero: getAssetValue(currentGame.libraryHeroImageUrl),
        grid: "",
      });
      setAssetDisplayPaths({
        icon: getDisplayPath(currentGame.iconUrl),
        logo: getDisplayPath(currentGame.logoImageUrl),
        hero: getDisplayPath(currentGame.libraryHeroImageUrl),
        grid: "",
      });
      setOriginalAssetPaths({
        icon:
          gameWithAssets.originalIconPath ||
          getDisplayPath(currentGame.iconUrl),
        logo:
          gameWithAssets.originalLogoPath ||
          getDisplayPath(currentGame.logoImageUrl),
        hero:
          gameWithAssets.originalHeroPath ||
          getDisplayPath(currentGame.libraryHeroImageUrl),
        grid: "",
      });

      setRemovedAssets({
        icon: iconRemoved,
        logo: logoRemoved,
        hero: heroRemoved,
        grid: false,
      });
    },
    [getAssetValue, getDisplayPath]
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
        icon: getAssetValue(currentGame.customIconUrl),
        logo: getAssetValue(currentGame.customLogoImageUrl),
        hero: getAssetValue(currentGame.customHeroImageUrl),
        grid: getAssetValue(currentGame.customCoverImageUrl),
      });
      setAssetDisplayPaths({
        icon: getDisplayPath(currentGame.customIconUrl),
        logo: getDisplayPath(currentGame.customLogoImageUrl),
        hero: getDisplayPath(currentGame.customHeroImageUrl),
        grid: getDisplayPath(currentGame.customCoverImageUrl),
      });
      setOriginalAssetPaths({
        icon:
          gameWithAssets.customOriginalIconPath ||
          getDisplayPath(currentGame.customIconUrl),
        logo:
          gameWithAssets.customOriginalLogoPath ||
          getDisplayPath(currentGame.customLogoImageUrl),
        hero:
          gameWithAssets.customOriginalHeroPath ||
          getDisplayPath(currentGame.customHeroImageUrl),
        grid:
          gameWithAssets.customOriginalCoverPath ||
          getDisplayPath(currentGame.customCoverImageUrl),
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
    [getAssetValue, getDisplayPath, shopDetails]
  );

  useEffect(() => {
    setRemovedAssets(INITIAL_REMOVED_ASSETS);
    setAssetPaths(INITIAL_ASSET_PATHS);
    setAssetDisplayPaths(INITIAL_ASSET_PATHS);
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

  const getAssetDisplayPath = (assetType: AssetType): string => {
    if (removedAssets[assetType]) {
      return "";
    }

    return assetDisplayPaths[assetType] || originalAssetPaths[assetType];
  };

  const updateAssetPaths = (
    assetType: AssetType,
    assetUrl: string,
    displayPath: string
  ): void => {
    setAssetPaths((prev) => ({ ...prev, [assetType]: assetUrl }));
    setAssetDisplayPaths((prev) => ({ ...prev, [assetType]: displayPath }));
    setOriginalAssetPaths((prev) => ({ ...prev, [assetType]: displayPath }));
    setRemovedAssets((prev) => ({ ...prev, [assetType]: false }));
  };

  const getOriginalAssetUrl = (assetType: AssetType): string | null => {
    if (!isCustomGame(game)) return null;

    switch (assetType) {
      case "icon":
        return game.iconUrl;
      case "logo":
        return game.logoImageUrl;
      case "hero":
        return game.libraryHeroImageUrl;
      default:
        return null;
    }
  };

  const openAssetCrop = (
    assetType: AssetType,
    sourcePath: string,
    displayPath = sourcePath,
    cleanupSource = false
  ) => {
    const pendingCrop = {
      assetType,
      sourcePath,
      displayPath,
      cleanupSource,
    };

    pendingAssetCropRef.current = pendingCrop;
    setPendingAssetCrop(pendingCrop);
    setIsPreparingAsset(false);
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
          openAssetCrop(assetType, filePaths[0]);
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

      openAssetCrop(assetType, filePath, filePath, cleanupSource);
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

  const persistCustomGameAsset = async (
    assetType: AssetType,
    assetUrl: string | null,
    displayPath: string
  ) => {
    const nextAssets = { ...assetPaths, [assetType]: assetUrl ?? "" };
    const heroUrl =
      assetType === "hero" && assetUrl === null
        ? game.libraryHeroImageUrl?.startsWith("data:image/svg+xml")
          ? game.libraryHeroImageUrl
          : generateRandomGradient()
        : nextAssets.hero || game.libraryHeroImageUrl;

    await window.electron.updateCustomGame({
      shop: game.shop,
      objectId: game.objectId,
      title: game.title,
      iconUrl: nextAssets.icon || undefined,
      logoImageUrl: nextAssets.logo || undefined,
      libraryHeroImageUrl: heroUrl || undefined,
      originalIconPath:
        assetType === "icon" && assetUrl
          ? displayPath
          : originalAssetPaths.icon || undefined,
      originalLogoPath:
        assetType === "logo" && assetUrl
          ? displayPath
          : originalAssetPaths.logo || undefined,
      originalHeroPath:
        assetType === "hero" && assetUrl
          ? displayPath
          : originalAssetPaths.hero || undefined,
    });
  };

  const persistNonCustomGameAsset = async (
    assetType: AssetType,
    assetUrl: string | null,
    displayPath: string
  ) => {
    const assetFields = {
      icon: ["customIconUrl", "customOriginalIconPath"],
      logo: ["customLogoImageUrl", "customOriginalLogoPath"],
      hero: ["customHeroImageUrl", "customOriginalHeroPath"],
      grid: ["customCoverImageUrl", "customOriginalCoverPath"],
    } as const;
    const [urlField, originalField] = assetFields[assetType];

    await window.electron.updateGameCustomAssets({
      shop: game.shop,
      objectId: game.objectId,
      title: game.title,
      [urlField]: assetUrl,
      [originalField]: assetUrl ? displayPath : null,
    });
  };

  const persistAssetChange = async (
    assetType: AssetType,
    assetUrl: string | null,
    displayPath: string,
    successMessage: string
  ) => {
    setIsUpdating(true);

    try {
      if (isCustomGame(game)) {
        await persistCustomGameAsset(assetType, assetUrl, displayPath);
      } else {
        await persistNonCustomGameAsset(assetType, assetUrl, displayPath);
      }

      if (assetUrl) {
        updateAssetPaths(assetType, assetUrl, displayPath);
      } else {
        setRemovedAssets((previous) => ({
          ...previous,
          [assetType]: true,
        }));
        setAssetPaths((previous) => ({ ...previous, [assetType]: "" }));
        setAssetDisplayPaths((previous) => ({
          ...previous,
          [assetType]: "",
        }));
      }

      try {
        await onGameUpdated();
        const previewUrl = assetUrl || defaultUrls[assetType];
        if (previewUrl) await preloadImage(previewUrl);
      } catch (error) {
        console.warn("Failed to refresh persisted game asset:", error);
      }

      showSuccessToast(successMessage);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRestoreDefault = async (assetType: AssetType) => {
    if (!beginAssetFlow()) return;

    try {
      await persistAssetChange(
        assetType,
        null,
        "",
        t("steamgriddb_artwork_reset")
      );
    } catch (error) {
      console.error("Failed to restore game asset:", error);
      showErrorToast(
        error instanceof Error ? error.message : t("edit_game_modal_failed")
      );
    } finally {
      releaseAssetFlow();
    }
  };

  const handleApplyCrop = async (result: ImageCropResult) => {
    const pendingCrop = pendingAssetCrop;
    if (!pendingCrop) return;

    let copiedAssetUrl: string | null = null;
    let persisted = false;

    try {
      copiedAssetUrl = await window.electron.copyCustomGameAsset(
        result.imagePath,
        pendingCrop.assetType
      );
      await persistAssetChange(
        pendingCrop.assetType,
        copiedAssetUrl,
        pendingCrop.displayPath,
        t("steamgriddb_artwork_updated")
      );
      persisted = true;
      pendingAssetCropRef.current = null;
      setPendingAssetCrop(null);

      if (
        result.byteLength !== undefined &&
        result.byteLength > 20 * 1024 * 1024
      ) {
        showWarningToast(t("custom_asset_sync_skipped_size"));
      }
    } catch (error) {
      if (!persisted && copiedAssetUrl?.startsWith("local:")) {
        await cleanupTempFile(copiedAssetUrl.slice("local:".length));
      }
      throw error;
    } finally {
      await cleanupTempFile(result.imagePath);

      if (persisted && pendingCrop.cleanupSource) {
        await cleanupTempFile(pendingCrop.sourcePath);
      }

      if (persisted) releaseAssetFlow();
    }
  };

  const isAssetFlowBusy =
    isUpdating || isPreparingAsset || pendingAssetCrop !== null;

  const getPreviewUrl = (assetType: AssetType): string | undefined => {
    const assetUrl = assetPaths[assetType];
    const defaultUrl = defaultUrls[assetType];

    if (!isCustomGame(game)) {
      return assetUrl || defaultUrl || undefined;
    }

    return assetUrl || undefined;
  };

  const renderImageSection = (assetType: AssetType) => {
    const assetPath = assetPaths[assetType];
    const assetDisplayPath = getAssetDisplayPath(assetType);
    const defaultUrl = defaultUrls[assetType];
    const hasImage = Boolean(assetPath || (!isCustomGame(game) && defaultUrl));
    const isDragOver = dragOverTarget === assetType;

    const getTranslationKey = (suffix: string) =>
      `edit_game_modal_${assetType}${suffix}`;
    const getResolutionKey = () => `edit_game_modal_${assetType}_resolution`;

    return (
      <div className="game-assets-settings__image-section">
        <TextField
          placeholder={t(`edit_game_modal_select_${assetType}`)}
          value={assetDisplayPath}
          readOnly
          theme="dark"
          rightContent={
            <div className="game-assets-settings__input-actions">
              <Button
                type="button"
                theme="outline"
                onClick={() => handleSelectAsset(assetType)}
                disabled={isAssetFlowBusy}
              >
                <ImageIcon />
                {t("edit_game_modal_browse")}
              </Button>
              {(assetPath ||
                (isCustomGame(game) && getOriginalAssetUrl(assetType))) && (
                <Button
                  type="button"
                  theme="outline"
                  onClick={() => handleRestoreDefault(assetType)}
                  disabled={isAssetFlowBusy}
                >
                  <XIcon />
                </Button>
              )}
            </div>
          }
        />

        <div className="game-assets-settings__resolution-info">
          {t(getResolutionKey())}
        </div>

        {hasImage ? (
          <button
            type="button"
            aria-label={t(getTranslationKey("_drop_zone"))}
            className={`game-assets-settings__image-preview ${
              PREVIEW_MODIFIER_CLASS[assetType] ?? ""
            } ${isDragOver ? "game-assets-settings__drop-zone--active" : ""}`}
            onDragOver={handleDragOver}
            onDragEnter={(event) => handleDragEnter(event, assetType)}
            onDragLeave={handleDragLeave}
            onDrop={(event) => handleAssetDrop(event, assetType)}
            onClick={() => handleSelectAsset(assetType)}
            disabled={isAssetFlowBusy}
          >
            <img
              src={getPreviewUrl(assetType)}
              alt={t(getTranslationKey("_preview"))}
              className="game-assets-settings__preview-image"
            />
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
          onCrop={({ wasEdited, ...params }) =>
            window.electron.cropGameAsset(pendingAssetCrop.sourcePath, {
              ...params,
              skipProcessingIfUnchanged: !wasEdited,
            })
          }
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
            currentArtworkUrl={
              assetPaths[selectedAssetType].startsWith("https:")
                ? assetPaths[selectedAssetType]
                : null
            }
            disabled={isAssetFlowBusy}
          />
        )}
      </div>
    </>
  );
}
