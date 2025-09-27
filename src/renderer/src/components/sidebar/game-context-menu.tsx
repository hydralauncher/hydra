import { useState } from "react";
import { useCollections } from "@renderer/hooks";
import type { LibraryGame } from "@types";
import { FileDirectoryIcon, PlusIcon } from "@primer/octicons-react";

interface GameContextMenuProps {
  game: LibraryGame;
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number };
}

export function GameContextMenu({
  game,
  isOpen,
  onClose,
  position,
}: Readonly<GameContextMenuProps>) {
  const { collections, addGameToCollection } = useCollections();
  const [showCollections, setShowCollections] = useState(false);

  const handleAddToCollection = async (collectionId: string) => {
    await addGameToCollection(collectionId, game.id);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="sidebar__context-menu-overlay"
        onClick={onClose}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        role="button"
        tabIndex={0}
      />
      <div
        className="sidebar__context-menu"
        style={{
          left: position.x,
          top: position.y,
        }}
        role="menu"
        tabIndex={-1}
      >
        <div
          className="sidebar__context-menu-item"
          onClick={() => setShowCollections(!showCollections)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setShowCollections(!showCollections);
            }
          }}
          role="menuitem"
          tabIndex={0}
        >
          <FileDirectoryIcon size={12} />
          <span>Adicionar à Coleção</span>
          <PlusIcon size={12} />
        </div>

        {showCollections && (
          <div className="sidebar__context-submenu">
            {collections.length === 0 ? (
              <div className="sidebar__context-menu-item sidebar__context-menu-item--disabled">
                Nenhuma coleção disponível
              </div>
            ) : (
              collections.map((collection) => {
                const isInCollection = collection.gameIds.includes(game.id);
                return (
                  <div
                    key={collection.id}
                    className={`sidebar__context-menu-item ${
                      isInCollection
                        ? "sidebar__context-menu-item--checked"
                        : ""
                    }`}
                    onClick={() =>
                      !isInCollection && handleAddToCollection(collection.id)
                    }
                    onKeyDown={(e) => {
                      if (
                        (e.key === "Enter" || e.key === " ") &&
                        !isInCollection
                      ) {
                        e.preventDefault();
                        handleAddToCollection(collection.id);
                      }
                    }}
                    role="menuitem"
                    tabIndex={isInCollection ? -1 : 0}
                  >
                    <span>📂</span>
                    <span>{collection.name}</span>
                    {isInCollection && (
                      <span style={{ marginLeft: "auto" }}>✓</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </>
  );
}
