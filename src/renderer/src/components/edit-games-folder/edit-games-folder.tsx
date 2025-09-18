import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Modal,
  TextField,
  FolderImageSelector,
} from "@renderer/components";
import { useLibrary } from "@renderer/hooks";
import { useGameFolders } from "@renderer/hooks/use-game-folders";
import type { LibraryGame, GameFolder } from "@types";

import "./edit-games-folder.scss";

export interface EditGamesFolderProps {
  visible: boolean;
  folder: GameFolder | null;
  onClose: () => void;
}

export function EditGamesFolder({
  visible,
  folder,
  onClose,
}: EditGamesFolderProps) {
  const { t } = useTranslation("games_folder");
  const { library } = useLibrary();
  const { updateFolder, deleteFolder } = useGameFolders();

  const [folderName, setFolderName] = useState("");
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [selectedImage, setSelectedImage] = useState<string | undefined>(
    undefined
  );
  const [selectedIcon, setSelectedIcon] = useState<string | undefined>(
    "folder"
  );
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Inicializar estados quando a pasta mudar
  useEffect(() => {
    if (folder) {
      setFolderName(folder.name);
      setSelectedGames(new Set(folder.gameIds));
      setSelectedImage(folder.customImage || undefined);
      setSelectedIcon(folder.icon || "folder");
    }
  }, [folder]);

  const handleGameToggle = (gameId: string) => {
    const newSelectedGames = new Set(selectedGames);
    if (newSelectedGames.has(gameId)) {
      newSelectedGames.delete(gameId);
    } else {
      newSelectedGames.add(gameId);
    }
    setSelectedGames(newSelectedGames);
  };

  const handleUpdateFolder = async () => {
    if (!folder || !folderName.trim() || selectedGames.size === 0) return;

    setIsUpdating(true);
    try {
      await updateFolder(folder.id, {
        name: folderName.trim(),
        gameIds: Array.from(selectedGames),
        icon: selectedIcon,
        customImage: selectedImage,
      });
      handleClose();
    } catch (error) {
      console.error("Erro ao atualizar pasta:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!folder) return;

    const confirmDelete = window.confirm(
      `${t("confirm_delete_folder")} "${folder.name}"?`
    );

    if (!confirmDelete) return;

    setIsDeleting(true);
    try {
      deleteFolder(folder.id);
      handleClose();
    } catch (error) {
      console.error("Erro ao deletar pasta:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    setFolderName("");
    setSelectedGames(new Set());
    setSelectedImage("");
    setSelectedIcon("folder");
    onClose();
  };

  if (!folder) return null;

  return (
    <Modal
      visible={visible}
      title={t("edit_games_folder")}
      onClose={handleClose}
      large
    >
      <div className="edit-games-folder__content">
        <div className="edit-games-folder__field">
          <TextField
            label={t("folder_name")}
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder={t("folder_name_placeholder")}
          />
        </div>

        <div className="edit-games-folder__field">
          <h3 className="edit-games-folder__section-title">
            {t("folder_image")}
          </h3>
          <FolderImageSelector
            selectedIcon={selectedIcon}
            selectedImage={selectedImage}
            onIconChange={setSelectedIcon}
            onImageChange={setSelectedImage}
          />
        </div>

        <div className="edit-games-folder__games-section">
          <h3 className="edit-games-folder__section-title">
            {t("select_games")}
          </h3>
          <div className="edit-games-folder__games-list">
            {library.map((game: LibraryGame) => (
              <div
                key={game.id}
                role="button"
                tabIndex={0}
                className="edit-games-folder__game-item"
                onClick={() => handleGameToggle(game.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleGameToggle(game.id);
                  }
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedGames.has(game.id)}
                  onChange={() => handleGameToggle(game.id)}
                  className="edit-games-folder__game-checkbox"
                />
                <img
                  src={game.iconUrl || "/default-game-icon.png"}
                  alt={game.title}
                  className="edit-games-folder__game-icon"
                />
                <span className="edit-games-folder__game-title">
                  {game.title}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="edit-games-folder__actions">
          <Button 
            onClick={handleDeleteFolder} 
            theme="danger" 
            disabled={isDeleting || isUpdating}
          >
            {isDeleting ? t("deleting") : t("delete_folder")}
          </Button>
          <div className="edit-games-folder__actions-right">
            <Button onClick={handleClose} theme="outline" disabled={isUpdating || isDeleting}>
              {t("cancel")}
            </Button>
            <Button
              onClick={handleUpdateFolder}
              disabled={
                !folderName.trim() || selectedGames.size === 0 || isUpdating || isDeleting
              }
            >
              {isUpdating ? t("updating") : t("update_folder")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
