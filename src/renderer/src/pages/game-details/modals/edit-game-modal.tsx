import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, XIcon } from "@primer/octicons-react";

import { Modal, TextField, Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { generateRandomGradient } from "@renderer/helpers";
import type { LibraryGame, Game, ShopDetailsWithAssets } from "@types";

import "./edit-game-modal.scss";

export interface EditGameModalProps {
  visible: boolean;
  onClose: () => void;
  game: LibraryGame | Game | null;
  shopDetails?: ShopDetailsWithAssets | null;
  onGameUpdated: (updatedGame: LibraryGame | Game) => void;
}

type AssetType = "icon" | "logo" | "hero";

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
}

interface AssetPaths {
  icon: string;
  logo: string;
  hero: string;
}

interface AssetUrls {
  icon: string | null;
  logo: string | null;
  hero: string | null;
}

interface RemovedAssets {
  icon: boolean;
  logo: boolean;
  hero: boolean;
}

const VALID_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp"] as const;

const INITIAL_ASSET_PATHS: AssetPaths = {
  icon: "",
  logo: "",
  hero: "",
};

const INITIAL_REMOVED_ASSETS: RemovedAssets = {
  icon: false,
  logo: false,
  hero: false,
};

const INITIAL_ASSET_URLS: AssetUrls = {
  icon: null,
  logo: null,
  hero: null,
};

export function EditGameModal({
  visible,
  onClose,
  game,
  shopDetails,
  onGameUpdated,
}: Readonly<EditGameModalProps>) {
  const { t } = useTranslation("sidebar");
  const { showSuccessToast, showErrorToast } = useToast();

  const [gameName, setGameName] = useState("");
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

  const isCustomGame = (game: LibraryGame | Game): boolean => {
    return game.shop === "custom";
  };

  const extractLocalPath = (url: string | null | undefined): string => {
    return url?.startsWith("local:") ? url.replace("local:", "") : "";
  };

  const capitalizeAssetType = (assetType: AssetType): string => {
    return assetType.charAt(0).toUpperCase() + assetType.slice(1);
  };

  const setCustomGameAssets = useCallback((game: LibraryGame | Game) => {
    const gameWithAssets = game as GameWithOriginalAssets;
    const iconRemoved =
      !game.iconUrl && Boolean(gameWithAssets.originalIconPath);
    const logoRemoved =
      !game.logoImageUrl && Boolean(gameWithAssets.originalLogoPath);
    const heroRemoved =
      !game.libraryHeroImageUrl && Boolean(gameWithAssets.originalHeroPath);

    setAssetPaths({
      icon: extractLocalPath(game.iconUrl),
      logo: extractLocalPath(game.logoImageUrl),
      hero: extractLocalPath(game.libraryHeroImageUrl),
    });
    setAssetDisplayPaths({
      icon: extractLocalPath(game.iconUrl),
      logo: extractLocalPath(game.logoImageUrl),
      hero: extractLocalPath(game.libraryHeroImageUrl),
    });
    setOriginalAssetPaths({
      icon: gameWithAssets.originalIconPath || extractLocalPath(game.iconUrl),
      logo:
        gameWithAssets.originalLogoPath || extractLocalPath(game.logoImageUrl),
      hero:
        gameWithAssets.originalHeroPath ||
        extractLocalPath(game.libraryHeroImageUrl),
    });

    setRemovedAssets({
      icon: iconRemoved,
      logo: logoRemoved,
      hero: heroRemoved,
    });
  }, []);

  const setNonCustomGameAssets = useCallback(
    (game: LibraryGame) => {
      const gameWithAssets = game as LibraryGameWithCustomOriginalAssets;
      const iconRemoved =
        !game.customIconUrl && Boolean(gameWithAssets.customOriginalIconPath);
      const logoRemoved =
        !game.customLogoImageUrl &&
        Boolean(gameWithAssets.customOriginalLogoPath);
      const heroRemoved =
        !game.customHeroImageUrl &&
        Boolean(gameWithAssets.customOriginalHeroPath);

      setAssetPaths({
        icon: extractLocalPath(game.customIconUrl),
        logo: extractLocalPath(game.customLogoImageUrl),
        hero: extractLocalPath(game.customHeroImageUrl),
      });
      setAssetDisplayPaths({
        icon: extractLocalPath(game.customIconUrl),
        logo: extractLocalPath(game.customLogoImageUrl),
        hero: extractLocalPath(game.customHeroImageUrl),
      });
      setOriginalAssetPaths({
        icon:
          gameWithAssets.customOriginalIconPath ||
          extractLocalPath(game.customIconUrl),
        logo:
          gameWithAssets.customOriginalLogoPath ||
          extractLocalPath(game.customLogoImageUrl),
        hero:
          gameWithAssets.customOriginalHeroPath ||
          extractLocalPath(game.customHeroImageUrl),
      });

      setRemovedAssets({
        icon: iconRemoved,
        logo: logoRemoved,
        hero: heroRemoved,
      });

      setDefaultUrls({
        icon: shopDetails?.assets?.iconUrl || game.iconUrl || null,
        logo: shopDetails?.assets?.logoImageUrl || game.logoImageUrl || null,
        hero:
          shopDetails?.assets?.libraryHeroImageUrl ||
          game.libraryHeroImageUrl ||
          null,
      });
    },
    [shopDetails]
  );

  useEffect(() => {
    if (game && visible) {
      setGameName(game.title || "");

      if (isCustomGame(game)) {
        setCustomGameAssets(game);
      } else {
        setNonCustomGameAssets(game as LibraryGame);
      }
    }
  }, [game, visible, shopDetails, setCustomGameAssets, setNonCustomGameAssets]);

  const handleGameNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setGameName(event.target.value);
  };

  const handleAssetTypeChange = (assetType: AssetType) => {
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
    path: string,
    displayPath: string
  ): void => {
    setAssetPaths((prev) => ({ ...prev, [assetType]: path }));
    setAssetDisplayPaths((prev) => ({ ...prev, [assetType]: displayPath }));
    setOriginalAssetPaths((prev) => ({ ...prev, [assetType]: displayPath }));
    setRemovedAssets((prev) => ({ ...prev, [assetType]: false }));
  };

  const getOriginalAssetUrl = (assetType: AssetType): string | null => {
    if (!game || !isCustomGame(game)) return null;

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

  const handleSelectAsset = async (assetType: AssetType) => {
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
      const originalPath = filePaths[0];
      try {
        const copiedAssetUrl = await window.electron.copyCustomGameAsset(
          originalPath,
          assetType
        );
        updateAssetPaths(
          assetType,
          copiedAssetUrl.replace("local:", ""),
          originalPath
        );
      } catch (error) {
        console.error(`Failed to copy ${assetType} asset:`, error);
        updateAssetPaths(assetType, originalPath, originalPath);
      }
    }
  };

  const handleRestoreDefault = (assetType: AssetType) => {
    setRemovedAssets((prev) => ({ ...prev, [assetType]: true }));
    setAssetPaths((prev) => ({ ...prev, [assetType]: "" }));
    setAssetDisplayPaths((prev) => ({ ...prev, [assetType]: "" }));
  };

  const getOriginalTitle = (): string => {
    if (!game) return "";
    return shopDetails?.assets?.title || game.title || "";
  };

  const handleRestoreDefaultTitle = () => {
    const originalTitle = getOriginalTitle();
    setGameName(originalTitle);
  };

  const isTitleChanged = useMemo((): boolean => {
    if (!game || isCustomGame(game)) return false;
    const originalTitle = shopDetails?.assets?.title || game.title || "";
    return gameName.trim() !== originalTitle.trim();
  }, [game, gameName, shopDetails]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent, target: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(target);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTarget(null);
    }
  };

  const validateImageFile = (file: File): boolean => {
    return VALID_IMAGE_TYPES.includes(
      file.type as (typeof VALID_IMAGE_TYPES)[number]
    );
  };

  const processDroppedFile = async (file: File, assetType: AssetType) => {
    setDragOverTarget(null);

    if (!validateImageFile(file)) {
      showErrorToast("Invalid file type. Please select an image file.");
      return;
    }

    try {
      let filePath: string;

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
      }

      const copiedAssetUrl = await window.electron.copyCustomGameAsset(
        filePath,
        assetType
      );

      updateAssetPaths(
        assetType,
        copiedAssetUrl.replace("local:", ""),
        filePath
      );
      showSuccessToast(
        `${capitalizeAssetType(assetType)} updated successfully!`
      );

      if (!("path" in file) && filePath) {
        try {
          await window.electron.deleteTempFile?.(filePath);
        } catch (cleanupError) {
          console.warn("Failed to clean up temporary file:", cleanupError);
        }
      }
    } catch (error) {
      console.error(`Failed to process dropped ${assetType}:`, error);
      showErrorToast(
        `Failed to process dropped ${assetType}. Please try again.`
      );
    }
  };

  const handleAssetDrop = async (e: React.DragEvent, assetType: AssetType) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);

    if (isUpdating) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await processDroppedFile(files[0], assetType);
    }
  };

  const prepareCustomGameAssets = (game: LibraryGame | Game) => {
    const iconUrl = removedAssets.icon
      ? null
      : assetPaths.icon
        ? `local:${assetPaths.icon}`
        : game.iconUrl;

    const logoImageUrl = removedAssets.logo
      ? null
      : assetPaths.logo
        ? `local:${assetPaths.logo}`
        : game.logoImageUrl;

    const libraryHeroImageUrl = removedAssets.hero
      ? game.libraryHeroImageUrl?.startsWith("data:image/svg+xml")
        ? game.libraryHeroImageUrl
        : generateRandomGradient()
      : assetPaths.hero
        ? `local:${assetPaths.hero}`
        : game.libraryHeroImageUrl;

    return { iconUrl, logoImageUrl, libraryHeroImageUrl };
  };

  const prepareNonCustomGameAssets = () => {
    const customIconUrl =
      !removedAssets.icon && assetPaths.icon
        ? `local:${assetPaths.icon}`
        : null;

    const customLogoImageUrl =
      !removedAssets.logo && assetPaths.logo
        ? `local:${assetPaths.logo}`
        : null;

    const customHeroImageUrl =
      !removedAssets.hero && assetPaths.hero
        ? `local:${assetPaths.hero}`
        : null;

    return {
      customIconUrl,
      customLogoImageUrl,
      customHeroImageUrl,
    };
  };

  const updateCustomGame = async (game: LibraryGame | Game) => {
    const { iconUrl, logoImageUrl, libraryHeroImageUrl } =
      prepareCustomGameAssets(game);

    return window.electron.updateCustomGame({
      shop: game.shop,
      objectId: game.objectId,
      title: gameName.trim(),
      iconUrl: iconUrl || undefined,
      logoImageUrl: logoImageUrl || undefined,
      libraryHeroImageUrl: libraryHeroImageUrl || undefined,
      originalIconPath: originalAssetPaths.icon || undefined,
      originalLogoPath: originalAssetPaths.logo || undefined,
      originalHeroPath: originalAssetPaths.hero || undefined,
    });
  };

  const updateNonCustomGame = async (game: LibraryGame) => {
    const { customIconUrl, customLogoImageUrl, customHeroImageUrl } =
      prepareNonCustomGameAssets();

    return window.electron.updateGameCustomAssets({
      shop: game.shop,
      objectId: game.objectId,
      title: gameName.trim(),
      customIconUrl,
      customLogoImageUrl,
      customHeroImageUrl,
      customOriginalIconPath: removedAssets.icon
        ? undefined
        : originalAssetPaths.icon || undefined,
      customOriginalLogoPath: removedAssets.logo
        ? undefined
        : originalAssetPaths.logo || undefined,
      customOriginalHeroPath: removedAssets.hero
        ? undefined
        : originalAssetPaths.hero || undefined,
    });
  };

  const handleUpdateGame = async () => {
    if (!game || !gameName.trim()) {
      showErrorToast(t("edit_game_modal_fill_required"));
      return;
    }

    setIsUpdating(true);

    try {
      const updatedGame =
        game && isCustomGame(game)
          ? await updateCustomGame(game)
          : await updateNonCustomGame(game as LibraryGame);

      showSuccessToast(t("edit_game_modal_success"));
      onGameUpdated(updatedGame);
      onClose();
    } catch (error) {
      console.error("Failed to update game:", error);
      showErrorToast(
        error instanceof Error ? error.message : t("edit_game_modal_failed")
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const resetFormToInitialState = useCallback(
    (game: LibraryGame | Game) => {
      setGameName(game.title || "");
      setRemovedAssets(INITIAL_REMOVED_ASSETS);
      setAssetPaths(INITIAL_ASSET_PATHS);
      setAssetDisplayPaths(INITIAL_ASSET_PATHS);
      setOriginalAssetPaths(INITIAL_ASSET_PATHS);

      if (isCustomGame(game)) {
        setCustomGameAssets(game);
        setDefaultUrls(INITIAL_ASSET_URLS);
      } else {
        setNonCustomGameAssets(game as LibraryGame);
      }
    },
    [setCustomGameAssets, setNonCustomGameAssets]
  );

  const handleClose = () => {
    if (!isUpdating && game) {
      resetFormToInitialState(game);
      onClose();
    }
  };

  const isFormValid = gameName.trim();

  const getPreviewUrl = (assetType: AssetType): string | undefined => {
    const assetPath = assetPaths[assetType];
    const defaultUrl = defaultUrls[assetType];

    if (game && !isCustomGame(game)) {
      return assetPath ? `local:${assetPath}` : defaultUrl || undefined;
    }
    return assetPath ? `local:${assetPath}` : undefined;
  };

  const renderImageSection = (assetType: AssetType) => {
    const assetPath = assetPaths[assetType];
    const assetDisplayPath = getAssetDisplayPath(assetType);
    const defaultUrl = defaultUrls[assetType];
    const hasImage = assetPath || (game && !isCustomGame(game) && defaultUrl);
    const isDragOver = dragOverTarget === assetType;

    const getTranslationKey = (suffix: string) =>
      `edit_game_modal_${assetType}${suffix}`;
    const getResolutionKey = () => `edit_game_modal_${assetType}_resolution`;

    return (
      <div className="edit-game-modal__image-section">
        <TextField
          placeholder={t(`edit_game_modal_select_${assetType}`)}
          value={assetDisplayPath}
          readOnly
          theme="dark"
          rightContent={
            <div style={{ display: "flex", gap: "8px" }}>
              <Button
                type="button"
                theme="outline"
                onClick={() => handleSelectAsset(assetType)}
                disabled={isUpdating}
              >
                <ImageIcon />
                {t("edit_game_modal_browse")}
              </Button>
              {game &&
                (assetPath ||
                  (isCustomGame(game) && getOriginalAssetUrl(assetType))) && (
                  <Button
                    type="button"
                    theme="outline"
                    onClick={() => handleRestoreDefault(assetType)}
                    disabled={isUpdating}
                    title={`Remove ${assetType}`}
                  >
                    <XIcon />
                  </Button>
                )}
            </div>
          }
        />
        <div className="edit-game-modal__resolution-info">
          {t(getResolutionKey())}
        </div>

        {hasImage && (
          <button
            type="button"
            aria-label={t(getTranslationKey("_drop_zone"))}
            className={`edit-game-modal__image-preview ${
              assetType === "icon" ? "edit-game-modal__icon-preview" : ""
            } ${isDragOver ? "edit-game-modal__drop-zone--active" : ""}`}
            onDragOver={handleDragOver}
            onDragEnter={(e) => handleDragEnter(e, assetType)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleAssetDrop(e, assetType)}
            onClick={() => handleSelectAsset(assetType)}
          >
            <img
              src={getPreviewUrl(assetType)}
              alt={t(getTranslationKey("_preview"))}
              className="edit-game-modal__preview-image"
            />
            {isDragOver && (
              <div className="edit-game-modal__drop-overlay">
                <span>{t(`edit_game_modal_drop_to_replace_${assetType}`)}</span>
              </div>
            )}
          </button>
        )}

        {!hasImage && (
          <button
            type="button"
            aria-label={t(getTranslationKey("_drop_zone_empty"))}
            className={`edit-game-modal__image-preview ${
              assetType === "icon" ? "edit-game-modal__icon-preview" : ""
            } edit-game-modal__drop-zone ${
              isDragOver ? "edit-game-modal__drop-zone--active" : ""
            }`}
            onDragOver={handleDragOver}
            onDragEnter={(e) => handleDragEnter(e, assetType)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleAssetDrop(e, assetType)}
            onClick={() => handleSelectAsset(assetType)}
          >
            <div className="edit-game-modal__drop-zone-content">
              <ImageIcon />
              <span>{t(`edit_game_modal_drop_${assetType}_image_here`)}</span>
            </div>
          </button>
        )}
      </div>
    );
  };

  return (
    <Modal
      visible={visible}
      title={t("edit_game_modal")}
      description={t("edit_game_modal_description")}
      onClose={handleClose}
    >
      <div className="edit-game-modal__container">
        <div className="edit-game-modal__form">
          <TextField
            label={t("edit_game_modal_title")}
            placeholder={t("edit_game_modal_enter_title")}
            value={gameName}
            onChange={handleGameNameChange}
            theme="dark"
            disabled={isUpdating}
            rightContent={
              isTitleChanged && (
                <Button
                  type="button"
                  theme="outline"
                  onClick={handleRestoreDefaultTitle}
                  disabled={isUpdating}
                  title="Restore default title"
                >
                  <XIcon />
                </Button>
              )
            }
          />

          <div className="edit-game-modal__asset-selector">
            <div className="edit-game-modal__asset-label">
              {t("edit_game_modal_assets")}
            </div>
            <div className="edit-game-modal__asset-tabs">
              <Button
                type="button"
                theme={selectedAssetType === "icon" ? "primary" : "outline"}
                onClick={() => handleAssetTypeChange("icon")}
                disabled={isUpdating}
              >
                {t("edit_game_modal_icon")}
              </Button>
              <Button
                type="button"
                theme={selectedAssetType === "logo" ? "primary" : "outline"}
                onClick={() => handleAssetTypeChange("logo")}
                disabled={isUpdating}
              >
                {t("edit_game_modal_logo")}
              </Button>
              <Button
                type="button"
                theme={selectedAssetType === "hero" ? "primary" : "outline"}
                onClick={() => handleAssetTypeChange("hero")}
                disabled={isUpdating}
              >
                {t("edit_game_modal_hero")}
              </Button>
            </div>
          </div>

          {renderImageSection(selectedAssetType)}
        </div>

        <div className="edit-game-modal__actions">
          <Button
            type="button"
            theme="outline"
            onClick={handleClose}
            disabled={isUpdating}
          >
            {t("edit_game_modal_cancel")}
          </Button>
          <Button
            type="button"
            theme="primary"
            onClick={handleUpdateGame}
            disabled={!isFormValid || isUpdating}
          >
            {isUpdating
              ? t("edit_game_modal_updating")
              : t("edit_game_modal_update")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
