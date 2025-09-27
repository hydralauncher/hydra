import { useState } from "react";
import { PlusIcon } from "@primer/octicons-react";
import { useCollections } from "@renderer/hooks";
import { AddGamesToCollectionModal } from "./add-games-to-collection-modal";
import type { Collection } from "@types";

export function CreateCollectionButton() {
  const { createCollection, collections } = useCollections();
  const [isCreating, setIsCreating] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [showAddGamesModal, setShowAddGamesModal] = useState(false);
  const [createdCollection, setCreatedCollection] = useState<Collection | null>(
    null
  );
  const [errorMessage, setErrorMessage] = useState("");

  const handleCreate = async () => {
    const trimmedName = newCollectionName.trim();

    if (!trimmedName) {
      setErrorMessage("Nome da coleção não pode estar vazio");
      return;
    }

    // Check if collection name already exists
    const nameExists = collections.some(
      (collection) =>
        collection.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (nameExists) {
      setErrorMessage("Já existe uma coleção com este nome");
      return;
    }

    try {
      setErrorMessage(""); // Clear any previous error
      const collection = await createCollection(trimmedName);
      setNewCollectionName("");
      setIsCreating(false);

      // Show modal to add games to the new collection
      if (collection) {
        setCreatedCollection(collection);
        setShowAddGamesModal(true);
      }
    } catch (error) {
      setErrorMessage("Erro ao criar coleção. Tente novamente.");
      console.error("Error creating collection:", error);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && newCollectionName.trim()) {
      handleCreate();
    } else if (e.key === "Escape") {
      setNewCollectionName("");
      setIsCreating(false);
      setErrorMessage("");
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewCollectionName(e.target.value);
    // Clear error message when user starts typing
    if (errorMessage) {
      setErrorMessage("");
    }
  };

  if (isCreating) {
    return (
      <div className="sidebar__create-collection">
        <div className="sidebar__create-collection-form">
          <input
            type="text"
            value={newCollectionName}
            onChange={handleInputChange}
            onKeyDown={handleKeyPress}
            placeholder="Digite o nome da coleção"
            className={`sidebar__create-collection-input ${errorMessage ? "sidebar__create-collection-input--error" : ""}`}
            autoFocus
            autoComplete="off"
            spellCheck="false"
          />
          <div className="sidebar__create-collection-buttons">
            <button
              type="button"
              className="sidebar__create-collection-cancel"
              onClick={() => {
                setIsCreating(false);
                setNewCollectionName("");
                setErrorMessage("");
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="sidebar__create-collection-submit"
              onClick={handleCreate}
              disabled={!newCollectionName.trim()}
            >
              Criar Coleção
            </button>
          </div>
        </div>
        {errorMessage && (
          <div className="sidebar__create-collection-error">{errorMessage}</div>
        )}
      </div>
    );
  }

  const handleCloseModal = () => {
    setShowAddGamesModal(false);
    setCreatedCollection(null);
  };

  return (
    <>
      <button
        type="button"
        className="sidebar__create-collection-button"
        onClick={() => setIsCreating(true)}
      >
        <PlusIcon size={14} />
        <span>Nova Coleção</span>
      </button>

      <AddGamesToCollectionModal
        collection={createdCollection}
        isOpen={showAddGamesModal}
        onClose={handleCloseModal}
      />
    </>
  );
}
