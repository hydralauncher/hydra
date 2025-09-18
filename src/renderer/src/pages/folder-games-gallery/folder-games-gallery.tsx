import { useParams, useNavigate } from "react-router-dom";
import { useGameFolders } from "@renderer/hooks/use-game-folders";
import { useLibrary } from "@renderer/hooks";
import { PlayIcon } from "@primer/octicons-react";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useTranslation } from "react-i18next";
import "./folder-games-gallery.scss";

export function FolderGamesGallery() {
  const { folderId } = useParams<{ folderId: string }>();
  const { folders } = useGameFolders();
  const { t } = useTranslation("games_folder");
  const { library } = useLibrary();
  const navigate = useNavigate();

  const folder = folders.find((f) => f.id === folderId);
  const folderGames = folder
    ? library.filter((game) => folder.gameIds.includes(game.id))
    : [];

  const handleGameClick = (gameId: string) => {
    const game = library.find((g) => g.id === gameId);
    if (game) {
      const path = buildGameDetailsPath({
        ...game,
        objectId: game.objectId,
      });
      navigate(path);
    }
  };

  if (!folder) {
    return (
      <section className="container">
        <div className="container__content folder-games-gallery">
          <div className="folder-games-gallery__header">
            <h1 className="folder-games-gallery__title">
              Pasta não encontrada
            </h1>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="container">
      <div className="container__content folder-games-gallery">
        <div className="folder-games-gallery__header">
          <h1 className="folder-games-gallery__title">{folder.name}</h1>
          <span className="folder-games-gallery__count">
            {folderGames.length} {folderGames.length === 1 ? "jogo" : "jogos"}
          </span>
        </div>

        <div className="folder-games-gallery__grid">
          {folderGames.map((game) => (
            <div
              key={game.id}
              className="folder-games-gallery__card"
              onClick={() => handleGameClick(game.id)}
            >
              <div className="folder-games-gallery__card-image">
                {game.coverImageUrl || game.libraryImageUrl || game.iconUrl ? (
                  <img
                    src={
                      game.coverImageUrl ??
                      game.libraryImageUrl ??
                      game.iconUrl ??
                      undefined
                    }
                    alt={game.title}
                    className="folder-games-gallery__card-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      // Fallback para iconUrl se a imagem principal falhar
                      if (target.src !== game.iconUrl && game.iconUrl) {
                        target.src = game.iconUrl;
                      }
                    }}
                  />
                ) : (
                  <div className="folder-games-gallery__card-placeholder">
                    <span>🎮</span>
                  </div>
                )}
                <div className="folder-games-gallery__card-overlay">
                  <button
                    type="button"
                    className="folder-games-gallery__play-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGameClick(game.id);
                    }}
                  >
                    <PlayIcon size={12} /> Jogar
                  </button>
                </div>
                {game.lastTimePlayed && (
                  <p className="folder-games-gallery__card-subtitle">
                    Jogado em{" "}
                    {new Date(game.lastTimePlayed).toLocaleDateString("pt-BR")}
                  </p>
                )}
              </div>
              <div className="folder-games-gallery__card-info">
                <h3 className="folder-games-gallery__card-title">
                  {game.title}
                </h3>
              </div>
            </div>
          ))}
        </div>

        {folderGames.length === 0 && (
          <div className="folder-games-gallery__empty">
            <p>{t("empty_folder")}</p>
            <p>{t("add_games_to_folder", { folderName: folder.name })}</p>
          </div>
        )}
      </div>
    </section>
  );
}
