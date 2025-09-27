import { useState, useEffect } from "react";
import { PencilIcon, TrashIcon, XIcon } from "@primer/octicons-react";
import { useCollections, useLibrary } from "@renderer/hooks";
import type { Collection } from "@types";
import "./collection-info-modal.scss";

interface CollectionInfoModalProps {
  collection: Collection | null;
  isOpen: boolean;
  onClose: () => void;
}

export function CollectionInfoModal({
  collection,
  isOpen,
  onClose,
}: CollectionInfoModalProps) {
  const { updateCollection, deleteCollection, collections } = useCollections();
  const { library } = useLibrary();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [renameError, setRenameError] = useState("");

  useEffect(() => {
    if (collection) {
      setEditName(collection.name);
    }
  }, [collection]);

  if (!isOpen || !collection) return null;

  const collectionGames = library.filter((game) =>
    collection.gameIds.includes(`${game.shop}:${game.objectId}`)
  );

  const handleRename = async () => {
    const trimmedName = editName.trim();

    if (!trimmedName) {
      setRenameError("Nome da coleção não pode estar vazio");
      return;
    }

    if (trimmedName === collection.name) {
      setIsEditing(false);
      return;
    }

    // Check if collection name already exists (excluding current collection)
    const nameExists = collections.some(
      (c) =>
        c.id !== collection.id &&
        c.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (nameExists) {
      setRenameError("Já existe uma coleção com este nome");
      return;
    }

    try {
      setRenameError(""); // Clear any previous error
      await updateCollection(collection.id, { name: trimmedName });
      setIsEditing(false);
    } catch (error) {
      setRenameError("Erro ao renomear coleção. Tente novamente.");
      console.error("Error renaming collection:", error);
    }
  };

  const handleDelete = async () => {
    if (
      confirm(`Tem certeza que deseja excluir a coleção "${collection.name}"?`)
    ) {
      await deleteCollection(collection.id);
      onClose();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRename();
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditName(collection.name);
      setRenameError("");
    }
  };

  const handleEditNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditName(e.target.value);
    // Clear error message when user starts typing
    if (renameError) {
      setRenameError("");
    }
  };

  return (
    <div className="collection-modal-overlay" onClick={onClose}>
      <div className="collection-modal" onClick={(e) => e.stopPropagation()}>
        <div className="collection-modal-header">
          <h2 className="collection-modal-title">📂 Informações da Coleção</h2>
          <button className="collection-modal-close" onClick={onClose}>
            <XIcon size={20} />
          </button>
        </div>

        <div className="collection-modal-content">
          <div className="collection-modal-info">
            <div className="collection-modal-name-section">
              <label className="collection-modal-label">Nome da Coleção:</label>
              {isEditing ? (
                <input
                  type="text"
                  value={editName}
                  onChange={handleEditNameChange}
                  onBlur={handleRename}
                  onKeyDown={handleKeyPress}
                  className={`collection-modal-name-input ${renameError ? "collection-modal-name-input--error" : ""}`}
                  autoFocus
                />
              ) : (
                <div className="collection-modal-name-display">
                  <span className="collection-modal-name">
                    {collection.name}
                  </span>
                  <button
                    className="collection-modal-edit-button"
                    onClick={() => setIsEditing(true)}
                  >
                    <PencilIcon size={16} />
                  </button>
                </div>
              )}
              {renameError && (
                <div className="collection-modal-error">{renameError}</div>
              )}
            </div>

            <div className="collection-modal-stats">
              <div className="collection-modal-stat">
                <span className="collection-modal-stat-label">
                  Total de Jogos:
                </span>
                <span className="collection-modal-stat-value">
                  {collectionGames.length}
                </span>
              </div>
              <div className="collection-modal-stat">
                <span className="collection-modal-stat-label">Criada em:</span>
                <span className="collection-modal-stat-value">
                  {new Date(collection.createdAt).toLocaleDateString("pt-BR")}
                </span>
              </div>
              <div className="collection-modal-stat">
                <span className="collection-modal-stat-label">
                  Última atualização:
                </span>
                <span className="collection-modal-stat-value">
                  {new Date(collection.updatedAt).toLocaleDateString("pt-BR")}
                </span>
              </div>
            </div>
          </div>

          <div className="collection-modal-games">
            <h3 className="collection-modal-games-title">
              Jogos nesta Coleção:
            </h3>
            {collectionGames.length === 0 ? (
              <div className="collection-modal-empty">
                <p>Nenhum jogo adicionado a esta coleção ainda.</p>
              </div>
            ) : (
              <div className="collection-modal-games-list">
                {collectionGames.map((game) => (
                  <div key={game.id} className="collection-modal-game-item">
                    {game.iconUrl ? (
                      <img
                        src={game.iconUrl}
                        alt={game.title}
                        className="collection-modal-game-icon"
                      />
                    ) : (
                      <div className="collection-modal-game-icon-placeholder">
                        🎮
                      </div>
                    )}
                    <div className="collection-modal-game-info">
                      <span className="collection-modal-game-title">
                        {game.title}
                      </span>
                      <span className="collection-modal-game-shop">
                        {game.shop}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="collection-modal-actions">
          <button
            className="collection-modal-delete-button"
            onClick={handleDelete}
          >
            <TrashIcon size={16} />
            Excluir Coleção
          </button>
        </div>
      </div>
    </div>
  );
}
