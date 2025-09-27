import { useState, useEffect } from "react";
import { XIcon, PlusIcon } from "@primer/octicons-react";
import { useCollections, useLibrary } from "@renderer/hooks";
import type { Collection, LibraryGame } from "@types";
import "./add-games-to-collection-modal.scss";

interface AddGamesToCollectionModalProps {
  collection: Collection | null;
  isOpen: boolean;
  onClose: () => void;
  onGamesAdded?: () => void;
}

export function AddGamesToCollectionModal({
  collection,
  isOpen,
  onClose,
  onGamesAdded,
}: AddGamesToCollectionModalProps) {
  const { addGameToCollection } = useCollections();
  const { library } = useLibrary();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (collection && isOpen) {
      // Pre-select games that are already in the collection
      setSelectedGames(new Set(collection.gameIds));
    } else if (!isOpen) {
      // Clear selection when modal is closed
      setSelectedGames(new Set());
    }
  }, [collection, isOpen]);

  if (!isOpen || !collection) return null;

  const availableGames = library.filter((game) => {
    const matchesSearch = game.title
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const handleGameToggle = (game: LibraryGame) => {
    const gameId = `${game.shop}:${game.objectId}`;
    const newSelectedGames = new Set(selectedGames);

    if (newSelectedGames.has(gameId)) {
      newSelectedGames.delete(gameId);
    } else {
      newSelectedGames.add(gameId);
    }

    setSelectedGames(newSelectedGames);
  };

  const handleAddSelectedGames = async () => {
    const gamesToAdd = Array.from(selectedGames).filter(
      (gameId) => !collection.gameIds.includes(gameId)
    );

    console.log("Games to add:", gamesToAdd);
    console.log("Selected games:", Array.from(selectedGames));
    console.log("Collection gameIds:", collection.gameIds);

    try {
      // Add all games sequentially to avoid race conditions
      for (const gameId of gamesToAdd) {
        console.log("Adding game:", gameId);
        await addGameToCollection(collection.id, gameId);
      }

      console.log("All games added successfully");
      // Call success callback if provided, otherwise just close
      if (onGamesAdded) {
        onGamesAdded();
      } else {
        onClose();
      }
    } catch (error) {
      console.error("Error adding games to collection:", error);
      // Don't close modal if there was an error
    }
  };

  const handleClose = () => {
    setSearchTerm("");
    setSelectedGames(new Set());
    onClose();
  };

  const newGamesCount = Array.from(selectedGames).filter(
    (gameId) => !collection.gameIds.includes(gameId)
  ).length;

  return (
    <div
      className="add-games-modal-overlay"
      onClick={handleClose}
      onKeyDown={(e) => e.key === "Escape" && handleClose()}
      role="button"
      tabIndex={0}
    >
      <div className="add-games-modal" role="dialog" tabIndex={-1}>
        <div className="add-games-modal-header">
          <h2 className="add-games-modal-title">
            🎮 Adicionar Jogos à Coleção
          </h2>
          <button className="add-games-modal-close" onClick={handleClose}>
            <XIcon size={20} />
          </button>
        </div>

        <div className="add-games-modal-content">
          <div className="add-games-modal-info">
            <h3 className="add-games-modal-collection-name">
              {collection.name}
            </h3>
            <p className="add-games-modal-description">
              Selecione os jogos que deseja adicionar à sua nova coleção
            </p>
          </div>

          <div className="add-games-modal-search">
            <input
              type="text"
              placeholder="Buscar jogos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="add-games-modal-search-input"
            />
          </div>

          <div className="add-games-modal-games">
            <div className="add-games-modal-games-header">
              <span className="add-games-modal-games-count">
                {availableGames.length} jogos disponíveis
              </span>
              {newGamesCount > 0 && (
                <span className="add-games-modal-selected-count">
                  {newGamesCount} selecionados
                </span>
              )}
            </div>

            <div className="add-games-modal-games-list">
              {availableGames.length === 0 ? (
                <div className="add-games-modal-empty">
                  <p>Nenhum jogo encontrado</p>
                </div>
              ) : (
                availableGames.map((game) => {
                  const gameId = `${game.shop}:${game.objectId}`;
                  const isSelected = selectedGames.has(gameId);
                  const isAlreadyInCollection =
                    collection.gameIds.includes(gameId);

                  return (
                    <div
                      key={game.id}
                      className={cn("add-games-modal-game-item", {
                        "add-games-modal-game-item--selected": isSelected,
                        "add-games-modal-game-item--already-in":
                          isAlreadyInCollection,
                      })}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isAlreadyInCollection) {
                          handleGameToggle(game);
                        }
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (
                          (e.key === "Enter" || e.key === " ") &&
                          !isAlreadyInCollection
                        ) {
                          e.preventDefault();
                          handleGameToggle(game);
                        }
                      }}
                      role="button"
                      tabIndex={isAlreadyInCollection ? -1 : 0}
                    >
                      {game.iconUrl ? (
                        <img
                          src={game.iconUrl}
                          alt={game.title}
                          className="add-games-modal-game-icon"
                        />
                      ) : (
                        <div className="add-games-modal-game-icon-placeholder">
                          🎮
                        </div>
                      )}

                      <div className="add-games-modal-game-info">
                        <span className="add-games-modal-game-title">
                          {game.title}
                        </span>
                        <span className="add-games-modal-game-shop">
                          {game.shop}
                        </span>
                      </div>

                      <div className="add-games-modal-game-status">
                        {isAlreadyInCollection ? (
                          <span className="add-games-modal-game-status-text">
                            Já na coleção
                          </span>
                        ) : isSelected ? (
                          <PlusIcon
                            size={16}
                            className="add-games-modal-game-check"
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="add-games-modal-actions">
          <button
            className="add-games-modal-cancel-button"
            onClick={handleClose}
          >
            Cancelar
          </button>
          <button
            className="add-games-modal-add-button"
            onClick={handleAddSelectedGames}
            disabled={newGamesCount === 0}
          >
            <PlusIcon size={16} />
            Adicionar {newGamesCount > 0 ? `${newGamesCount} jogos` : "jogos"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper function for classnames
function cn(
  ...classes: (string | boolean | undefined | Record<string, boolean>)[]
): string {
  return classes
    .map((cls) => {
      if (typeof cls === "object" && cls !== null) {
        return Object.entries(cls)
          .filter(([, value]) => value)
          .map(([key]) => key)
          .join(" ");
      }
      return cls;
    })
    .filter(Boolean)
    .join(" ");
}
