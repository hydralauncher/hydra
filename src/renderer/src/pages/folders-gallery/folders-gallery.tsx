import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useGameFolders } from "@renderer/hooks/use-game-folders";
import { useLibrary } from "@renderer/hooks";
import { PencilIcon } from "@primer/octicons-react";
import { EditGamesFolder, FolderIcon } from "@renderer/components";
import type { GameFolder } from "@types";
import "./folders-gallery.scss";

export function FoldersGallery() {
  const { t } = useTranslation("sidebar");
  const navigate = useNavigate();
  const { folders } = useGameFolders();
  const { library } = useLibrary();

  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<GameFolder | null>(null);

  const getGamesByFolder = (gameIds: string[]) => {
    return library.filter((game) => gameIds.includes(game.id));
  };

  const handleFolderClick = (folderId: string) => {
    navigate(`/folders-gallery/${folderId}`);
  };

  const handleEditFolder = (folder: GameFolder, event: React.MouseEvent) => {
    event.stopPropagation(); // Evita que o clique abra a pasta
    setSelectedFolder(folder);
    setShowEditModal(true);
  };

  const handleCloseEditModal = () => {
    setShowEditModal(false);
    setSelectedFolder(null);
  };

  return (
    <section className="folders-gallery__container">
      <div className="folders-gallery__content">
        <div className="folders-gallery__header">
          <h1 className="folders-gallery__title">{t("custom_folders")}</h1>
          <div className="folders-gallery__count">
            {folders.length} {folders.length === 1 ? "pasta" : "pastas"}
          </div>
        </div>

        <div className="folders-gallery__grid">
          {folders.map((folder) => {
            const folderGames = getGamesByFolder(folder.gameIds);

            return (
              <div
                key={folder.id}
                className="folders-gallery__card"
                onClick={() => handleFolderClick(folder.id)}
              >
                <div className="folders-gallery__card-image">
                  {folder.customImage ? (
                    <img
                      src={folder.customImage}
                      alt={folder.name}
                      className="folders-gallery__card-cover"
                    />
                  ) : folder.icon ? (
                    <div className="folders-gallery__card-placeholder">
                      <FolderIcon iconId={folder.icon} size={48} />
                    </div>
                  ) : (
                    <div className="folders-gallery__card-placeholder">
                      <FolderIcon iconId="folder" size={48} />
                    </div>
                  )}
                  <div className="folders-gallery__card-overlay">
                    <span className="folders-gallery__card-count">
                      {folderGames.length}{" "}
                      {folderGames.length === 1 ? "jogo" : "jogos"}
                    </span>
                  </div>
                </div>
                <div className="folders-gallery__card-info">
                  <h3 className="folders-gallery__card-title">{folder.name}</h3>
                  <button
                    type="button"
                    className="folders-gallery__edit-button"
                    onClick={(e) => handleEditFolder(folder, e)}
                    title={t("edit_games_folder")}
                  >
                    <PencilIcon size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {folders.length === 0 && (
          <div className="folders-gallery__empty">
            <p>Nenhuma pasta personalizada encontrada.</p>
            <p>Crie pastas na sidebar para organizá-las aqui!</p>
          </div>
        )}

        <EditGamesFolder
          visible={showEditModal}
          folder={selectedFolder}
          onClose={handleCloseEditModal}
        />
      </div>
    </section>
  );
}
