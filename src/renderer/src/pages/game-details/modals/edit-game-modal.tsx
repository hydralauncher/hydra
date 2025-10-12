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
  const [assetPaths, setAssetPaths] = useState({
    icon: "",
    logo: "",
    hero: "",
  });
  const [assetDisplayPaths, setAssetDisplayPaths] = useState({
    icon: "",
    logo: "",
    hero: "",
  });
  const [originalAssetPaths, setOriginalAssetPaths] = useState({
    icon: "",
    logo: "",
    hero: "",
  });
  const [removedAssets, setRemovedAssets] = useState({
    icon: false,
    logo: false,
    hero: false,
  });
  const [defaultUrls, setDefaultUrls] = useState({
    icon: null as string | null,
    logo: null as string | null,
    hero: null as string | null,
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedAssetType, setSelectedAssetType] = useState<AssetType>("icon");

  const isCustomGame = (game: LibraryGame | Game): boolean => {
    return game.shop === "custom";
  };

  const extractLocalPath = (url: string | null | undefined): string => {
    return url?.startsWith("local:") ? url.replace("local:", "") : "";
  };

  const setCustomGameAssets = useCallback((game: LibraryGame | Game) => {
    // Check if assets were removed (URLs are null but original paths exist)
    const iconRemoved = !game.iconUrl && (game as any).originalIconPath;
    const logoRemoved = !game.logoImageUrl && (game as any).originalLogoPath;
    const heroRemoved =
      !game.libraryHeroImageUrl && (game as any).originalHeroPath;

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
      icon: (game as any).originalIconPath || extractLocalPath(game.iconUrl),
      logo:
        (game as any).originalLogoPath || extractLocalPath(game.logoImageUrl),
      hero:
        (game as any).originalHeroPath ||
        extractLocalPath(game.libraryHeroImageUrl),
    });

    // Set removed assets state based on whether assets were explicitly removed
    setRemovedAssets({
      icon: iconRemoved,
      logo: logoRemoved,
      hero: heroRemoved,
    });
  }, []);

  const setNonCustomGameAssets = useCallback(
    (game: LibraryGame) => {
      // Check if assets were removed (custom URLs are null but original paths exist)
      const iconRemoved =
        !game.customIconUrl && (game as any).customOriginalIconPath;
      const logoRemoved =
        !game.customLogoImageUrl && (game as any).customOriginalLogoPath;
      const heroRemoved =
        !game.customHeroImageUrl && (game as any).customOriginalHeroPath;

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
          (game as any).customOriginalIconPath ||
          extractLocalPath(game.customIconUrl),
        logo:
          (game as any).customOriginalLogoPath ||
          extractLocalPath(game.customLogoImageUrl),
        hero:
          (game as any).customOriginalHeroPath ||
          extractLocalPath(game.customHeroImageUrl),
      });

      // Set removed assets state based on whether assets were explicitly removed
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

  const getAssetPath = (assetType: AssetType): string => {
    return assetPaths[assetType];
  };

  const getAssetDisplayPath = (assetType: AssetType): string => {
    // If asset was removed, don't show any path
    if (removedAssets[assetType]) {
      return "";
    }
    // Use display path first, then fall back to original path
    return assetDisplayPaths[assetType] || originalAssetPaths[assetType];
  };

  const setAssetPath = (assetType: AssetType, path: string): void => {
    setAssetPaths((prev) => ({ ...prev, [assetType]: path }));
  };

  const setAssetDisplayPath = (assetType: AssetType, path: string): void => {
    setAssetDisplayPaths((prev) => ({ ...prev, [assetType]: path }));
  };

  const getDefaultUrl = (assetType: AssetType): string | null => {
    return defaultUrls[assetType];
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
          extensions: ["jpg", "jpeg", "png", "gif", "webp"],
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
        setAssetPath(assetType, copiedAssetUrl.replace("local:", ""));
        setAssetDisplayPath(assetType, originalPath);
        // Store the original path for display purposes
        setOriginalAssetPaths((prev) => ({
          ...prev,
          [assetType]: originalPath,
        }));
        // Clear the removed flag when a new asset is selected
        setRemovedAssets((prev) => ({ ...prev, [assetType]: false }));
      } catch (error) {
        console.error(`Failed to copy ${assetType} asset:`, error);
        setAssetPath(assetType, originalPath);
        setAssetDisplayPath(assetType, originalPath);
        setOriginalAssetPaths((prev) => ({
          ...prev,
          [assetType]: originalPath,
        }));
        // Clear the removed flag when a new asset is selected
        setRemovedAssets((prev) => ({ ...prev, [assetType]: false }));
      }
    }
  };

  const handleRestoreDefault = (assetType: AssetType) => {
    // Mark asset as removed and clear paths (for both custom and non-custom games)
    setRemovedAssets((prev) => ({ ...prev, [assetType]: true }));
    setAssetPath(assetType, "");
    setAssetDisplayPath(assetType, "");
    // Don't clear originalAssetPaths - keep them for reference but don't use them for display
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

  const isTitleChanged = useMemo((): boolean => {
    if (!game || isCustomGame(game)) return false;
    const originalTitle = getOriginalTitle();
    return gameName.trim() !== originalTitle.trim();
  }, [game, gameName, shopDetails]);

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
      setAssetDisplayPath(assetType, filePath);

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
    // For custom games, check if asset was explicitly removed
    let iconUrl;
    if (removedAssets.icon) {
      iconUrl = null;
    } else if (assetPaths.icon) {
      iconUrl = `local:${assetPaths.icon}`;
    } else {
      iconUrl = game.iconUrl;
    }

    let logoImageUrl;
    if (removedAssets.logo) {
      logoImageUrl = null;
    } else if (assetPaths.logo) {
      logoImageUrl = `local:${assetPaths.logo}`;
    } else {
      logoImageUrl = game.logoImageUrl;
    }

    // For hero image, if removed, restore to the original gradient or keep the original
    let libraryHeroImageUrl;
    if (removedAssets.hero) {
      // If the original hero was a gradient (data URL), keep it, otherwise generate a new one
      const originalHero = game.libraryHeroImageUrl;
      libraryHeroImageUrl = originalHero?.startsWith("data:image/svg+xml")
        ? originalHero
        : generateRandomGradient();
    } else {
      libraryHeroImageUrl = assetPaths.hero
        ? `local:${assetPaths.hero}`
        : game.libraryHeroImageUrl;
    }

    return { iconUrl, logoImageUrl, libraryHeroImageUrl };
  };

  // Helper function to prepare non-custom game assets
  const prepareNonCustomGameAssets = () => {
    const hasIconPath = assetPaths.icon;
    let customIconUrl: string | null = null;
    if (!removedAssets.icon && hasIconPath) {
      customIconUrl = `local:${assetPaths.icon}`;
    }

    const hasLogoPath = assetPaths.logo;
    let customLogoImageUrl: string | null = null;
    if (!removedAssets.logo && hasLogoPath) {
      customLogoImageUrl = `local:${assetPaths.logo}`;
    }

    const hasHeroPath = assetPaths.hero;
    let customHeroImageUrl: string | null = null;
    if (!removedAssets.hero && hasHeroPath) {
      customHeroImageUrl = `local:${assetPaths.hero}`;
    }

    return {
      customIconUrl,
      customLogoImageUrl,
      customHeroImageUrl,
    };
  };

  // Helper function to update custom game
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

  // Helper function to update non-custom game
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

  // Helper function to reset form to initial state
  const resetFormToInitialState = useCallback(
    (game: LibraryGame | Game) => {
      setGameName(game.title || "");

      // Reset removed assets state
      setRemovedAssets({
        icon: false,
        logo: false,
        hero: false,
      });

      // Clear all asset paths to ensure clean state
      setAssetPaths({
        icon: "",
        logo: "",
        hero: "",
      });
      setAssetDisplayPaths({
        icon: "",
        logo: "",
        hero: "",
      });
      setOriginalAssetPaths({
        icon: "",
        logo: "",
        hero: "",
      });

      if (isCustomGame(game)) {
        setCustomGameAssets(game);
        // Clear default URLs for custom games
        setDefaultUrls({
          icon: null,
          logo: null,
          hero: null,
        });
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
    const assetPath = getAssetPath(assetType);
    const defaultUrl = getDefaultUrl(assetType);

    if (game && !isCustomGame(game)) {
      return assetPath ? `local:${assetPath}` : defaultUrl || undefined;
    }
    return assetPath ? `local:${assetPath}` : undefined;
  };

  const renderImageSection = (assetType: AssetType) => {
    const assetPath = getAssetPath(assetType);
    const assetDisplayPath = getAssetDisplayPath(assetType);
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
