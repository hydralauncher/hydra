import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, XIcon } from "@primer/octicons-react";

import { Modal, TextField, Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
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
  const [iconPath, setIconPath] = useState("");
  const [logoPath, setLogoPath] = useState("");
  const [heroPath, setHeroPath] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedAssetType, setSelectedAssetType] = useState<AssetType>("icon");

  const [defaultIconUrl, setDefaultIconUrl] = useState<string | null>(null);
  const [defaultLogoUrl, setDefaultLogoUrl] = useState<string | null>(null);
  const [defaultHeroUrl, setDefaultHeroUrl] = useState<string | null>(null);

  const isCustomGame = (game: LibraryGame | Game): boolean => {
    return game.shop === "custom";
  };

  const extractLocalPath = (url: string | null | undefined): string => {
    return url?.startsWith("local:") ? url.replace("local:", "") : "";
  };

  const setCustomGameAssets = useCallback((game: LibraryGame | Game) => {
    setIconPath(extractLocalPath(game.iconUrl));
    setLogoPath(extractLocalPath(game.logoImageUrl));
    setHeroPath(extractLocalPath(game.libraryHeroImageUrl));
  }, []);

  const setNonCustomGameAssets = useCallback(
    (game: LibraryGame) => {
      setIconPath(extractLocalPath(game.customIconUrl));
      setLogoPath(extractLocalPath(game.customLogoImageUrl));
      setHeroPath(extractLocalPath(game.customHeroImageUrl));

      setDefaultIconUrl(shopDetails?.assets?.iconUrl || game.iconUrl || null);
      setDefaultLogoUrl(
        shopDetails?.assets?.logoImageUrl || game.logoImageUrl || null
      );
      setDefaultHeroUrl(
        shopDetails?.assets?.libraryHeroImageUrl ||
          game.libraryHeroImageUrl ||
          null
      );
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

  const getAssetPath = (assetType: AssetType): string => {
    switch (assetType) {
      case "icon":
        return iconPath;
      case "logo":
        return logoPath;
      case "hero":
        return heroPath;
    }
  };

  const setAssetPath = (assetType: AssetType, path: string): void => {
    switch (assetType) {
      case "icon":
        setIconPath(path);
        break;
      case "logo":
        setLogoPath(path);
        break;
      case "hero":
        setHeroPath(path);
        break;
    }
  };

  const getDefaultUrl = (assetType: AssetType): string | null => {
    switch (assetType) {
      case "icon":
        return defaultIconUrl;
      case "logo":
        return defaultLogoUrl;
      case "hero":
        return defaultHeroUrl;
    }
  };

  const handleSelectAsset = async (assetType: AssetType) => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: t("edit_game_modal_image_filter"),
          extensions: ["jpg", "jpeg", "png", "gif", "webp"],
        },
      ],
    });

    if (filePaths && filePaths.length > 0) {
      try {
        const copiedAssetUrl = await window.electron.copyCustomGameAsset(
          filePaths[0],
          assetType
        );
        setAssetPath(assetType, copiedAssetUrl.replace("local:", ""));
      } catch (error) {
        console.error(`Failed to copy ${assetType} asset:`, error);
        setAssetPath(assetType, filePaths[0]);
      }
    }
  };

  const handleRestoreDefault = (assetType: AssetType) => {
    setAssetPath(assetType, "");
  };

  const getOriginalTitle = (): string => {
    if (!game) return "";

    // For non-custom games, the original title is from shopDetails assets
    return shopDetails?.assets?.title || game.title || "";
  };

  const handleRestoreDefaultTitle = () => {
    const originalTitle = getOriginalTitle();
    setGameName(originalTitle);
  };

  const isTitleChanged = (): boolean => {
    if (!game || isCustomGame(game)) return false;
    const originalTitle = getOriginalTitle();
    return gameName.trim() !== originalTitle.trim();
  };

  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

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
    const validTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ];
    return validTypes.includes(file.type);
  };

  const processDroppedFile = async (file: File, assetType: AssetType) => {
    setDragOverTarget(null);

    if (!validateImageFile(file)) {
      showErrorToast("Invalid file type. Please select an image file.");
      return;
    }

    try {
      let filePath: string;

      interface ElectronFile extends File {
        path?: string;
      }

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

      const assetPath = copiedAssetUrl.replace("local:", "");
      setAssetPath(assetType, assetPath);

      showSuccessToast(
        `${assetType.charAt(0).toUpperCase() + assetType.slice(1)} updated successfully!`
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

  // Helper function to prepare custom game assets
  const prepareCustomGameAssets = (game: LibraryGame | Game) => {
    const iconUrl = iconPath ? `local:${iconPath}` : game.iconUrl;
    const logoImageUrl = logoPath ? `local:${logoPath}` : game.logoImageUrl;
    const libraryHeroImageUrl = heroPath
      ? `local:${heroPath}`
      : game.libraryHeroImageUrl;

    return { iconUrl, logoImageUrl, libraryHeroImageUrl };
  };

  // Helper function to prepare non-custom game assets
  const prepareNonCustomGameAssets = () => {
    return {
      customIconUrl: iconPath ? `local:${iconPath}` : null,
      customLogoImageUrl: logoPath ? `local:${logoPath}` : null,
      customHeroImageUrl: heroPath ? `local:${heroPath}` : null,
    };
  };

  // Helper function to update custom game
  const updateCustomGame = async (game: LibraryGame | Game) => {
    const { iconUrl, logoImageUrl, libraryHeroImageUrl } =
      prepareCustomGameAssets(game);

    return window.electron.updateCustomGame(
      game.shop,
      game.objectId,
      gameName.trim(),
      iconUrl || undefined,
      logoImageUrl || undefined,
      libraryHeroImageUrl || undefined
    );
  };

  // Helper function to update non-custom game
  const updateNonCustomGame = async (game: LibraryGame) => {
    const { customIconUrl, customLogoImageUrl, customHeroImageUrl } =
      prepareNonCustomGameAssets();

    return window.electron.updateGameCustomAssets(
      game.shop,
      game.objectId,
      gameName.trim(),
      customIconUrl,
      customLogoImageUrl,
      customHeroImageUrl
    );
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

  // Helper function to reset form to initial state
  const resetFormToInitialState = (game: LibraryGame | Game) => {
    setGameName(game.title || "");

    if (isCustomGame(game)) {
      setCustomGameAssets(game);
      // Clear default URLs for custom games
      setDefaultIconUrl(null);
      setDefaultLogoUrl(null);
      setDefaultHeroUrl(null);
    } else {
      setNonCustomGameAssets(game as LibraryGame);
    }
  };

  const handleClose = () => {
    if (!isUpdating && game) {
      resetFormToInitialState(game);
      onClose();
    }
  };

  const isFormValid = gameName.trim();

  const getPreviewUrl = (assetType: AssetType): string | undefined => {
    const assetPath = getAssetPath(assetType);
    const defaultUrl = getDefaultUrl(assetType);

    if (game && !isCustomGame(game)) {
      return assetPath ? `local:${assetPath}` : defaultUrl || undefined;
    }
    return assetPath ? `local:${assetPath}` : undefined;
  };

  const renderImageSection = (assetType: AssetType) => {
    const assetPath = getAssetPath(assetType);
    const defaultUrl = getDefaultUrl(assetType);
    const hasImage = assetPath || (game && !isCustomGame(game) && defaultUrl);
    const isDragOver = dragOverTarget === assetType;

    const getTranslationKey = (suffix: string) =>
      `edit_game_modal_${assetType}${suffix}`;
    const getResolutionKey = () => `edit_game_modal_${assetType}_resolution`;

    return (
      <div className="edit-game-modal__image-section">
        <TextField
          placeholder={t(`edit_game_modal_select_${assetType}`)}
          value={assetPath}
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
              {game && !isCustomGame(game) && assetPath && (
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
                <span>Drop to replace {assetType}</span>
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
              <span>Drop {assetType} image here</span>
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
              isTitleChanged() && (
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
