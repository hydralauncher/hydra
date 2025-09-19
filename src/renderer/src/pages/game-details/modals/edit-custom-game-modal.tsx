import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon } from "@primer/octicons-react";

import { Modal, TextField, Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { Game } from "@types";

import "./edit-custom-game-modal.scss";

export interface EditCustomGameModalProps {
  visible: boolean;
  onClose: () => void;
  game: Game;
  onGameUpdated: (updatedGame: Game) => void;
}

export function EditCustomGameModal({
  visible,
  onClose,
  game,
  onGameUpdated,
}: EditCustomGameModalProps) {
  const { t } = useTranslation("sidebar");
  const { showSuccessToast, showErrorToast } = useToast();

  const [gameName, setGameName] = useState("");
  const [iconPath, setIconPath] = useState("");
  const [logoPath, setLogoPath] = useState("");
  const [heroPath, setHeroPath] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (game && visible) {
      setGameName(game.title || "");
      
      const currentIconPath = game.iconUrl?.startsWith("local:") 
        ? game.iconUrl.replace("local:", "") 
        : "";
      const currentLogoPath = game.logoImageUrl?.startsWith("local:") 
        ? game.logoImageUrl.replace("local:", "") 
        : "";
      const currentHeroPath = game.libraryHeroImageUrl?.startsWith("local:") 
        ? game.libraryHeroImageUrl.replace("local:", "") 
        : "";
        
      setIconPath(currentIconPath);
      setLogoPath(currentLogoPath);
      setHeroPath(currentHeroPath);
    }
  }, [game, visible]);

  const handleGameNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setGameName(event.target.value);
  };

  const handleSelectIcon = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: t("edit_custom_game_modal_image_filter"),
          extensions: ["jpg", "jpeg", "png", "gif", "webp"],
        },
      ],
    });

    if (filePaths && filePaths.length > 0) {
      setIconPath(filePaths[0]);
    }
  };

  const handleSelectLogo = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: t("edit_custom_game_modal_image_filter"),
          extensions: ["jpg", "jpeg", "png", "gif", "webp"],
        },
      ],
    });

    if (filePaths && filePaths.length > 0) {
      setLogoPath(filePaths[0]);
    }
  };

  const handleSelectHero = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: t("edit_custom_game_modal_image_filter"),
          extensions: ["jpg", "jpeg", "png", "gif", "webp"],
        },
      ],
    });

    if (filePaths && filePaths.length > 0) {
      setHeroPath(filePaths[0]);
    }
  };

  const handleUpdateGame = async () => {
    if (!gameName.trim()) {
      showErrorToast(t("edit_custom_game_modal_fill_required"));
      return;
    }

    setIsUpdating(true);

    try {
      // Preserve existing image URLs if not changed
      const iconUrl = iconPath ? `local:${iconPath}` : game.iconUrl;
      const logoImageUrl = logoPath ? `local:${logoPath}` : game.logoImageUrl;
      const libraryHeroImageUrl = heroPath ? `local:${heroPath}` : game.libraryHeroImageUrl;
      
      const updatedGame = await window.electron.updateCustomGame(
        game.shop,
        game.objectId,
        gameName.trim(),
        iconUrl || undefined,
        logoImageUrl || undefined,
        libraryHeroImageUrl || undefined
      );

      showSuccessToast(t("edit_custom_game_modal_success"));
      onGameUpdated(updatedGame);
      onClose();
    } catch (error) {
      console.error("Failed to update custom game:", error);
      showErrorToast(
        error instanceof Error 
          ? error.message 
          : t("edit_custom_game_modal_failed")
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const handleClose = () => {
    if (!isUpdating) {
      setGameName(game?.title || "");
      
      const currentIconPath = game?.iconUrl?.startsWith("local:") 
        ? game.iconUrl.replace("local:", "") 
        : "";
      const currentLogoPath = game?.logoImageUrl?.startsWith("local:") 
        ? game.logoImageUrl.replace("local:", "") 
        : "";
      const currentHeroPath = game?.libraryHeroImageUrl?.startsWith("local:") 
        ? game.libraryHeroImageUrl.replace("local:", "") 
        : "";
        
      setIconPath(currentIconPath);
      setLogoPath(currentLogoPath);
      setHeroPath(currentHeroPath);
      onClose();
    }
  };

  const isFormValid = gameName.trim();

  const getIconPreviewUrl = () => {
    return iconPath ? `local:${iconPath}` : null;
  };

  const getLogoPreviewUrl = () => {
    return logoPath ? `local:${logoPath}` : null;
  };

  const getHeroPreviewUrl = () => {
    return heroPath ? `local:${heroPath}` : null;
  };

  return (
    <Modal
      visible={visible}
      title={t("edit_custom_game_modal")}
      description={t("edit_custom_game_modal_description")}
      onClose={handleClose}
    >
      <div className="edit-custom-game-modal__container">
        <div className="edit-custom-game-modal__form">
          <TextField
            label={t("edit_custom_game_modal_game_name")}
            placeholder={t("edit_custom_game_modal_enter_name")}
            value={gameName}
            onChange={handleGameNameChange}
            theme="dark"
            disabled={isUpdating}
          />

          <div className="edit-custom-game-modal__image-section">
            <TextField
              label={t("edit_custom_game_modal_icon")}
              placeholder={t("edit_custom_game_modal_select_icon")}
              value={iconPath}
              readOnly
              theme="dark"
              rightContent={
                <Button
                  type="button"
                  theme="outline"
                  onClick={handleSelectIcon}
                  disabled={isUpdating}
                >
                  <ImageIcon />
                  {t("edit_custom_game_modal_browse")}
                </Button>
              }
            />
            
            {iconPath && (
              <div className="edit-custom-game-modal__image-preview">
                <img
                  src={getIconPreviewUrl()!}
                  alt={t("edit_custom_game_modal_icon_preview")}
                  className="edit-custom-game-modal__preview-image"
                />
              </div>
            )}
          </div>

          <div className="edit-custom-game-modal__image-section">
            <TextField
              label={t("edit_custom_game_modal_logo")}
              placeholder={t("edit_custom_game_modal_select_logo")}
              value={logoPath}
              readOnly
              theme="dark"
              rightContent={
                <Button
                  type="button"
                  theme="outline"
                  onClick={handleSelectLogo}
                  disabled={isUpdating}
                >
                  <ImageIcon />
                  {t("edit_custom_game_modal_browse")}
                </Button>
              }
            />
            
            {logoPath && (
              <div className="edit-custom-game-modal__image-preview">
                <img
                  src={getLogoPreviewUrl()!}
                  alt={t("edit_custom_game_modal_logo_preview")}
                  className="edit-custom-game-modal__preview-image"
                />
              </div>
            )}
          </div>

          <div className="edit-custom-game-modal__image-section">
            <TextField
              label={t("edit_custom_game_modal_hero")}
              placeholder={t("edit_custom_game_modal_select_hero")}
              value={heroPath}
              readOnly
              theme="dark"
              rightContent={
                <Button
                  type="button"
                  theme="outline"
                  onClick={handleSelectHero}
                  disabled={isUpdating}
                >
                  <ImageIcon />
                  {t("edit_custom_game_modal_browse")}
                </Button>
              }
            />
            
            {heroPath && (
              <div className="edit-custom-game-modal__image-preview">
                <img
                  src={getHeroPreviewUrl()!}
                  alt={t("edit_custom_game_modal_hero_preview")}
                  className="edit-custom-game-modal__preview-image"
                />
              </div>
            )}
          </div>
        </div>

        <div className="edit-custom-game-modal__actions">
          <Button 
            type="button" 
            theme="outline" 
            onClick={handleClose}
            disabled={isUpdating}
          >
            {t("edit_custom_game_modal_cancel")}
          </Button>
          <Button 
            type="button" 
            theme="primary" 
            onClick={handleUpdateGame}
            disabled={!isFormValid || isUpdating}
          >
            {isUpdating ? t("edit_custom_game_modal_updating") : t("edit_custom_game_modal_update")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}