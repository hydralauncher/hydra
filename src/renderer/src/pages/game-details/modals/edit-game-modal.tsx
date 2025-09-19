import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon } from "@primer/octicons-react";

import { Modal, TextField, Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { LibraryGame } from "@types";

import "./edit-game-modal.scss";

export interface EditGameModalProps {
  visible: boolean;
  onClose: () => void;
  game: LibraryGame | null;
  onGameUpdated: (updatedGame: any) => void;
}

export function EditGameModal({
  visible,
  onClose,
  game,
  onGameUpdated,
}: EditGameModalProps) {
  const { t } = useTranslation("sidebar");
  const { showSuccessToast, showErrorToast } = useToast();

  const [gameName, setGameName] = useState("");
  const [iconPath, setIconPath] = useState("");
  const [logoPath, setLogoPath] = useState("");
  const [heroPath, setHeroPath] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  // Helper function to extract local path from URL
  const extractLocalPath = (url: string | null | undefined): string => {
    return url?.startsWith("local:") ? url.replace("local:", "") : "";
  };

  // Helper function to set asset paths for custom games
  const setCustomGameAssets = (game: LibraryGame) => {
    setIconPath(extractLocalPath(game.iconUrl));
    setLogoPath(extractLocalPath(game.logoImageUrl));
    setHeroPath(extractLocalPath(game.libraryHeroImageUrl));
  };

  // Helper function to set asset paths for non-custom games
  const setNonCustomGameAssets = (game: LibraryGame) => {
    setIconPath(extractLocalPath(game.customIconUrl));
    setLogoPath(extractLocalPath(game.customLogoImageUrl));
    setHeroPath(extractLocalPath(game.customHeroImageUrl));
  };

  useEffect(() => {
    if (game && visible) {
      setGameName(game.title || "");

      if (game.shop === "custom") {
        setCustomGameAssets(game);
      } else {
        setNonCustomGameAssets(game);
      }
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

  // Helper function to prepare custom game assets
  const prepareCustomGameAssets = (game: LibraryGame) => {
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
  const updateCustomGame = async (game: LibraryGame) => {
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
      showErrorToast(t("edit_custom_game_modal_fill_required"));
      return;
    }

    setIsUpdating(true);

    try {
      const updatedGame =
        game.shop === "custom"
          ? await updateCustomGame(game)
          : await updateNonCustomGame(game);

      showSuccessToast(t("edit_custom_game_modal_success"));
      onGameUpdated(updatedGame);
      onClose();
    } catch (error) {
      console.error("Failed to update game:", error);
      showErrorToast(
        error instanceof Error
          ? error.message
          : t("edit_custom_game_modal_failed")
      );
    } finally {
      setIsUpdating(false);
    }
  };

  // Helper function to reset form to initial state
  const resetFormToInitialState = (game: LibraryGame) => {
    setGameName(game.title || "");

    if (game.shop === "custom") {
      setCustomGameAssets(game);
    } else {
      setNonCustomGameAssets(game);
    }
  };

  const handleClose = () => {
    if (!isUpdating && game) {
      resetFormToInitialState(game);
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
      <div className="edit-game-modal__container">
        <div className="edit-game-modal__form">
          <TextField
            label={t("edit_custom_game_modal_game_name")}
            placeholder={t("edit_custom_game_modal_enter_name")}
            value={gameName}
            onChange={handleGameNameChange}
            theme="dark"
            disabled={isUpdating}
          />

          <div className="edit-game-modal__image-section">
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
              <div className="edit-game-modal__image-preview">
                <img
                  src={getIconPreviewUrl()!}
                  alt={t("edit_custom_game_modal_icon_preview")}
                  className="edit-game-modal__preview-image"
                />
              </div>
            )}
          </div>

          <div className="edit-game-modal__image-section">
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
              <div className="edit-game-modal__image-preview">
                <img
                  src={getLogoPreviewUrl()!}
                  alt={t("edit_custom_game_modal_logo_preview")}
                  className="edit-game-modal__preview-image"
                />
              </div>
            )}
          </div>

          <div className="edit-game-modal__image-section">
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
              <div className="edit-game-modal__image-preview">
                <img
                  src={getHeroPreviewUrl()!}
                  alt={t("edit_custom_game_modal_hero_preview")}
                  className="edit-game-modal__preview-image"
                />
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
            {t("edit_custom_game_modal_cancel")}
          </Button>
          <Button
            type="button"
            theme="primary"
            onClick={handleUpdateGame}
            disabled={!isFormValid || isUpdating}
          >
            {isUpdating
              ? t("edit_custom_game_modal_updating")
              : t("edit_custom_game_modal_update")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
