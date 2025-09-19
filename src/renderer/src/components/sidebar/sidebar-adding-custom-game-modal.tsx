import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { FileDirectoryIcon } from "@primer/octicons-react";

import { Modal, TextField, Button } from "@renderer/components";
import { useLibrary, useToast } from "@renderer/hooks";
import { buildGameDetailsPath, generateRandomGradient } from "@renderer/helpers";

import "./sidebar-adding-custom-game-modal.scss";

export interface SidebarAddingCustomGameModalProps {
  visible: boolean;
  onClose: () => void;
}

export function SidebarAddingCustomGameModal({
  visible,
  onClose,
}: SidebarAddingCustomGameModalProps) {
  const { t } = useTranslation("sidebar");
  const { updateLibrary } = useLibrary();
  const { showSuccessToast, showErrorToast } = useToast();
  const navigate = useNavigate();

  const [gameName, setGameName] = useState("");
  const [executablePath, setExecutablePath] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleSelectExecutable = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: t("custom_game_modal_executable"),
          extensions: ["exe", "msi", "app", "deb", "rpm", "dmg"],
        },
      ],
    });

    if (filePaths && filePaths.length > 0) {
      const selectedPath = filePaths[0];
      setExecutablePath(selectedPath);
      
      if (!gameName.trim()) {
        const fileName = selectedPath.split(/[\\/]/).pop() || "";
        const gameNameFromFile = fileName.replace(/\.[^/.]+$/, "");
        setGameName(gameNameFromFile);
      }
    }
  };

  const handleGameNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setGameName(event.target.value);
  };



  const handleAddGame = async () => {
    if (!gameName.trim() || !executablePath.trim()) {
      showErrorToast(t("custom_game_modal_fill_required"));
      return;
    }

    setIsAdding(true);

    try {
      // Generate gradient URL only for hero image
      const gameNameForSeed = gameName.trim();
      const iconUrl = ""; // Don't use gradient for icon
      const logoImageUrl = ""; // Don't use gradient for logo
      const libraryHeroImageUrl = generateRandomGradient(); // Only use gradient for hero
      
      const newGame = await window.electron.addCustomGameToLibrary(
        gameNameForSeed,
        executablePath,
        iconUrl,
        logoImageUrl,
        libraryHeroImageUrl
      );

      showSuccessToast(t("custom_game_modal_success"));
      updateLibrary();
      
      const gameDetailsPath = buildGameDetailsPath({
        shop: "custom",
        objectId: newGame.objectId,
        title: newGame.title
      });
      
      navigate(gameDetailsPath);
      
      setGameName("");
      setExecutablePath("");
      onClose();
    } catch (error) {
      console.error("Failed to add custom game:", error);
      showErrorToast(
        error instanceof Error 
          ? error.message 
          : t("custom_game_modal_failed")
      );
    } finally {
      setIsAdding(false);
    }
  };

  const handleClose = () => {
    if (!isAdding) {
      setGameName("");
      setExecutablePath("");
      onClose();
    }
  };

  const isFormValid = gameName.trim() && executablePath.trim();



  return (
    <Modal
      visible={visible}
      title={t("custom_game_modal")}
      description={t("custom_game_modal_description")}
      onClose={handleClose}
    >
      <div className="sidebar-adding-custom-game-modal__container">
        <div className="sidebar-adding-custom-game-modal__form">
          <TextField
            label={t("custom_game_modal_executable_path")}
            placeholder={t("custom_game_modal_select_executable")}
            value={executablePath}
            readOnly
            theme="dark"
            rightContent={
              <Button
                type="button"
                theme="outline"
                onClick={handleSelectExecutable}
                disabled={isAdding}
              >
                <FileDirectoryIcon />
                {t("custom_game_modal_browse")}
              </Button>
            }
          />

          <TextField
            label={t("custom_game_modal_game_name")}
            placeholder={t("custom_game_modal_enter_name")}
            value={gameName}
            onChange={handleGameNameChange}
            theme="dark"
            disabled={isAdding}
          />




        </div>

        <div className="sidebar-adding-custom-game-modal__actions">
          <Button 
            type="button" 
            theme="outline" 
            onClick={handleClose}
            disabled={isAdding}
          >
            {t("custom_game_modal_cancel")}
          </Button>
          <Button 
            type="button" 
            theme="primary" 
            onClick={handleAddGame}
            disabled={!isFormValid || isAdding}
          >
            {isAdding ? t("custom_game_modal_adding") : t("custom_game_modal_add")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}