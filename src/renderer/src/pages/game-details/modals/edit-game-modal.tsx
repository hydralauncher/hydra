import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, ReplyIcon } from "@primer/octicons-react";

import { Modal, TextField, Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { LibraryGame, Game, ShopDetailsWithAssets } from "@types";

import "./edit-game-modal.scss";

export interface EditGameModalProps {
  visible: boolean;
  onClose: () => void;
  game: LibraryGame | Game | null;
  shopDetails?: ShopDetailsWithAssets | null;
  onGameUpdated: (updatedGame: any) => void;
}

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

  // Store default image URLs for non-custom games
  const [defaultIconUrl, setDefaultIconUrl] = useState<string | null>(null);
  const [defaultLogoUrl, setDefaultLogoUrl] = useState<string | null>(null);
  const [defaultHeroUrl, setDefaultHeroUrl] = useState<string | null>(null);

  // Helper function to check if game is a custom game
  const isCustomGame = (game: LibraryGame | Game): boolean => {
    return game.shop === "custom";
  };

  // Helper function to extract local path from URL
  const extractLocalPath = (url: string | null | undefined): string => {
    return url?.startsWith("local:") ? url.replace("local:", "") : "";
  };

  // Helper function to set asset paths for custom games
  const setCustomGameAssets = (game: LibraryGame | Game) => {
    setIconPath(extractLocalPath(game.iconUrl));
    setLogoPath(extractLocalPath(game.logoImageUrl));
    setHeroPath(extractLocalPath(game.libraryHeroImageUrl));
  };

  // Helper function to set asset paths for non-custom games
  const setNonCustomGameAssets = (game: LibraryGame) => {
    setIconPath(extractLocalPath(game.customIconUrl));
    setLogoPath(extractLocalPath(game.customLogoImageUrl));
    setHeroPath(extractLocalPath(game.customHeroImageUrl));

    // Store default URLs for restore functionality from shopDetails.assets
    setDefaultIconUrl(shopDetails?.assets?.iconUrl || game.iconUrl || null);
    setDefaultLogoUrl(
      shopDetails?.assets?.logoImageUrl || game.logoImageUrl || null
    );
    setDefaultHeroUrl(
      shopDetails?.assets?.libraryHeroImageUrl ||
        game.libraryHeroImageUrl ||
        null
    );
  };

  useEffect(() => {
    if (game && visible) {
      setGameName(game.title || "");

      if (isCustomGame(game)) {
        setCustomGameAssets(game);
      } else {
        setNonCustomGameAssets(game as LibraryGame);
      }
    }
  }, [game, visible, shopDetails]);

  const handleGameNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setGameName(event.target.value);
  };

  const handleSelectIcon = async () => {
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
        // Copy the asset to the app's assets folder
        const copiedAssetUrl = await window.electron.copyCustomGameAsset(
          filePaths[0],
          "icon"
        );
        setIconPath(copiedAssetUrl.replace("local:", ""));
      } catch (error) {
        console.error("Failed to copy icon asset:", error);
        // Fallback to original behavior
        setIconPath(filePaths[0]);
      }
    }
  };

  const handleSelectLogo = async () => {
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
        // Copy the asset to the app's assets folder
        const copiedAssetUrl = await window.electron.copyCustomGameAsset(
          filePaths[0],
          "logo"
        );
        setLogoPath(copiedAssetUrl.replace("local:", ""));
      } catch (error) {
        console.error("Failed to copy logo asset:", error);
        // Fallback to original behavior
        setLogoPath(filePaths[0]);
      }
    }
  };

  const handleSelectHero = async () => {
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
        // Copy the asset to the app's assets folder
        const copiedAssetUrl = await window.electron.copyCustomGameAsset(
          filePaths[0],
          "hero"
        );
        setHeroPath(copiedAssetUrl.replace("local:", ""));
      } catch (error) {
        console.error("Failed to copy hero asset:", error);
        // Fallback to original behavior
        setHeroPath(filePaths[0]);
      }
    }
  };

  // Helper functions to restore default images for non-custom games
  const handleRestoreDefaultIcon = () => {
    setIconPath("");
  };

  const handleRestoreDefaultLogo = () => {
    setLogoPath("");
  };

  const handleRestoreDefaultHero = () => {
    setHeroPath("");
  };

  // Drag and drop state
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  // Drag and drop handlers
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
    // Only clear drag state if we're leaving the drop zone entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTarget(null);
    }
  };

  const validateImageFile = (file: File): boolean => {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    return validTypes.includes(file.type);
  };

  const processDroppedFile = async (file: File, assetType: 'icon' | 'logo' | 'hero') => {
    setDragOverTarget(null);
    
    if (!validateImageFile(file)) {
      showErrorToast('Invalid file type. Please select an image file.');
      return;
    }

    try {
      // In Electron, we need to get the file path differently
      let filePath: string;
      
      // Try to get the path from the file object (Electron specific)
      if ('path' in file && typeof (file as any).path === 'string') {
        filePath = (file as any).path;
      } else {
        // Fallback: create a temporary file from the file data
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Use a temporary file approach
        const tempFileName = `temp_${Date.now()}_${file.name}`;
        const tempPath = await window.electron.saveTempFile?.(tempFileName, uint8Array);
        
        if (!tempPath) {
          throw new Error('Unable to process file. Drag and drop may not be fully supported.');
        }
        
        filePath = tempPath;
      }
      
      // Copy the asset to the app's assets folder using the file path
      const copiedAssetUrl = await window.electron.copyCustomGameAsset(
        filePath,
        assetType
      );
      
      const assetPath = copiedAssetUrl.replace("local:", "");
      
      switch (assetType) {
        case 'icon':
          setIconPath(assetPath);
          break;
        case 'logo':
          setLogoPath(assetPath);
          break;
        case 'hero':
          setHeroPath(assetPath);
          break;
      }
      
      showSuccessToast(`${assetType.charAt(0).toUpperCase() + assetType.slice(1)} updated successfully!`);
      
      // Clean up temporary file if we created one
      if (!('path' in file) && filePath) {
        try {
          await window.electron.deleteTempFile?.(filePath);
        } catch (cleanupError) {
          console.warn('Failed to clean up temporary file:', cleanupError);
        }
      }
    } catch (error) {
      console.error(`Failed to process dropped ${assetType}:`, error);
      showErrorToast(`Failed to process dropped ${assetType}. Please try again.`);
    }
  };

  const handleIconDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
    
    if (isUpdating) return;
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await processDroppedFile(files[0], 'icon');
    }
  };

  const handleLogoDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
    
    if (isUpdating) return;
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await processDroppedFile(files[0], 'logo');
    }
  };

  const handleHeroDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
    
    if (isUpdating) return;
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await processDroppedFile(files[0], 'hero');
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
        error instanceof Error
          ? error.message
          : t("edit_game_modal_failed")
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

  const getIconPreviewUrl = (): string | undefined => {
    if (game && !isCustomGame(game)) {
      // For non-custom games, show custom image if set, otherwise show default
      return iconPath ? `local:${iconPath}` : defaultIconUrl || undefined;
    }
    return iconPath ? `local:${iconPath}` : undefined;
  };

  const getLogoPreviewUrl = (): string | undefined => {
    if (game && !isCustomGame(game)) {
      // For non-custom games, show custom image if set, otherwise show default
      return logoPath ? `local:${logoPath}` : defaultLogoUrl || undefined;
    }
    return logoPath ? `local:${logoPath}` : undefined;
  };

  const getHeroPreviewUrl = (): string | undefined => {
    if (game && !isCustomGame(game)) {
      // For non-custom games, show custom image if set, otherwise show default
      return heroPath ? `local:${heroPath}` : defaultHeroUrl || undefined;
    }
    return heroPath ? `local:${heroPath}` : undefined;
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
          />

          <div className="edit-game-modal__image-section">
            <TextField
              label={t("edit_game_modal_icon")}
              placeholder={t("edit_game_modal_select_icon")}
              value={iconPath}
              readOnly
              theme="dark"
              rightContent={
                <div style={{ display: "flex", gap: "8px" }}>
                  <Button
                    type="button"
                    theme="outline"
                    onClick={handleSelectIcon}
                    disabled={isUpdating}
                  >
                    <ImageIcon />
                    {t("edit_game_modal_browse")}
                  </Button>
                  {game && !isCustomGame(game) && iconPath && (
                    <Button
                      type="button"
                      theme="outline"
                      onClick={handleRestoreDefaultIcon}
                      disabled={isUpdating}
                      title="Restore default icon"
                    >
                      <ReplyIcon />
                    </Button>
                  )}
                </div>
              }
            />
            <div className="edit-game-modal__resolution-info">
              {t("edit_game_modal_icon_resolution")}
            </div>

            {(iconPath || (game && !isCustomGame(game) && defaultIconUrl)) && (
              <div 
                className={`edit-game-modal__image-preview edit-game-modal__icon-preview ${
                  dragOverTarget === 'icon' ? 'edit-game-modal__drop-zone--active' : ''
                }`}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, 'icon')}
                onDragLeave={handleDragLeave}
                onDrop={handleIconDrop}
              >
                <img
                  src={getIconPreviewUrl()}
                  alt={t("edit_game_modal_icon_preview")}
                  className="edit-game-modal__preview-image"
                />
                {dragOverTarget === 'icon' && (
                  <div className="edit-game-modal__drop-overlay">
                    <span>Drop to replace icon</span>
                  </div>
                )}
              </div>
            )}

            {(!iconPath && !(game && !isCustomGame(game) && defaultIconUrl)) && (
              <div 
                className={`edit-game-modal__image-preview edit-game-modal__icon-preview edit-game-modal__drop-zone ${
                  dragOverTarget === 'icon' ? 'edit-game-modal__drop-zone--active' : ''
                }`}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, 'icon')}
                onDragLeave={handleDragLeave}
                onDrop={handleIconDrop}
              >
                <div className="edit-game-modal__drop-zone-content">
                  <ImageIcon />
                  <span>Drop icon image here</span>
                </div>
              </div>
            )}
          </div>

          <div className="edit-game-modal__image-section">
            <TextField
              label={t("edit_game_modal_logo")}
              placeholder={t("edit_game_modal_select_logo")}
              value={logoPath}
              readOnly
              theme="dark"
              rightContent={
                <div style={{ display: "flex", gap: "8px" }}>
                  <Button
                    type="button"
                    theme="outline"
                    onClick={handleSelectLogo}
                    disabled={isUpdating}
                  >
                    <ImageIcon />
                    {t("edit_game_modal_browse")}
                  </Button>
                  {game && !isCustomGame(game) && logoPath && (
                    <Button
                      type="button"
                      theme="outline"
                      onClick={handleRestoreDefaultLogo}
                      disabled={isUpdating}
                      title="Restore default logo"
                    >
                      <ReplyIcon />
                    </Button>
                  )}
                </div>
              }
            />
            <div className="edit-game-modal__resolution-info">
              {t("edit_game_modal_logo_resolution")}
            </div>

            {(logoPath || (game && !isCustomGame(game) && defaultLogoUrl)) && (
              <div 
                className={`edit-game-modal__image-preview ${
                  dragOverTarget === 'logo' ? 'edit-game-modal__drop-zone--active' : ''
                }`}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, 'logo')}
                onDragLeave={handleDragLeave}
                onDrop={handleLogoDrop}
              >
                <img
                  src={getLogoPreviewUrl()}
                  alt={t("edit_game_modal_logo_preview")}
                  className="edit-game-modal__preview-image"
                />
                {dragOverTarget === 'logo' && (
                  <div className="edit-game-modal__drop-overlay">
                    <span>Drop to replace logo</span>
                  </div>
                )}
              </div>
            )}

            {(!logoPath && !(game && !isCustomGame(game) && defaultLogoUrl)) && (
              <div 
                className={`edit-game-modal__image-preview edit-game-modal__drop-zone ${
                  dragOverTarget === 'logo' ? 'edit-game-modal__drop-zone--active' : ''
                }`}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, 'logo')}
                onDragLeave={handleDragLeave}
                onDrop={handleLogoDrop}
              >
                <div className="edit-game-modal__drop-zone-content">
                  <ImageIcon />
                  <span>Drop logo image here</span>
                </div>
              </div>
            )}
          </div>

          <div className="edit-game-modal__image-section">
            <TextField
              label={t("edit_game_modal_hero")}
              placeholder={t("edit_game_modal_select_hero")}
              value={heroPath}
              readOnly
              theme="dark"
              rightContent={
                <div style={{ display: "flex", gap: "8px" }}>
                  <Button
                    type="button"
                    theme="outline"
                    onClick={handleSelectHero}
                    disabled={isUpdating}
                  >
                    <ImageIcon />
                    {t("edit_game_modal_browse")}
                  </Button>
                  {game && !isCustomGame(game) && heroPath && (
                    <Button
                      type="button"
                      theme="outline"
                      onClick={handleRestoreDefaultHero}
                      disabled={isUpdating}
                      title="Restore default hero image"
                    >
                      <ReplyIcon />
                    </Button>
                  )}
                </div>
              }
            />
            <div className="edit-game-modal__resolution-info">
              {t("edit_game_modal_hero_resolution")}
            </div>

            {(heroPath || (game && !isCustomGame(game) && defaultHeroUrl)) && (
              <div 
                className={`edit-game-modal__image-preview ${
                  dragOverTarget === 'hero' ? 'edit-game-modal__drop-zone--active' : ''
                }`}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, 'hero')}
                onDragLeave={handleDragLeave}
                onDrop={handleHeroDrop}
              >
                <img
                  src={getHeroPreviewUrl()}
                  alt={t("edit_game_modal_hero_preview")}
                  className="edit-game-modal__preview-image"
                />
                {dragOverTarget === 'hero' && (
                  <div className="edit-game-modal__drop-overlay">
                    <span>Drop to replace hero image</span>
                  </div>
                )}
              </div>
            )}

            {(!heroPath && !(game && !isCustomGame(game) && defaultHeroUrl)) && (
              <div 
                className={`edit-game-modal__image-preview edit-game-modal__drop-zone ${
                  dragOverTarget === 'hero' ? 'edit-game-modal__drop-zone--active' : ''
                }`}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, 'hero')}
                onDragLeave={handleDragLeave}
                onDrop={handleHeroDrop}
              >
                <div className="edit-game-modal__drop-zone-content">
                  <ImageIcon />
                  <span>Drop hero image here</span>
                </div>
              </div>
            )}
          </div>
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
