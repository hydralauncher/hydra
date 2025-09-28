import { useNavigate } from "react-router-dom";
import cn from "classnames";
import { useState } from "react";
import type { Collection } from "@types";
import { useCollections } from "@renderer/hooks";
import { CollectionInfoModal } from "./collection-info-modal";

interface SidebarCollectionItemProps {
  collection: Collection;
  onSelectCollection?: (collection: Collection) => void;
  selectedCollectionId?: string;
}

export function SidebarCollectionItem({
  collection,
  selectedCollectionId,
}: Readonly<SidebarCollectionItemProps>) {
  const navigate = useNavigate();
  const { addGameToCollection } = useCollections();
  const [showModal, setShowModal] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const isActive = selectedCollectionId === collection.id;

  const handleClick = () => {
    // Navigate to the specific collection page instead of filtering
    navigate(`/collections/${collection.id}`);
  };

  // Context menu will be handled by right click

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);

    try {
      const data = JSON.parse(event.dataTransfer.getData("application/json"));
      if (data.type === "game" && data.gameId) {
        if (!collection.gameIds.includes(data.gameId)) {
          await addGameToCollection(collection.id, data.gameId);
        }
      }
    } catch (error) {
      console.error("Error handling drop:", error);
    }
  };

  return (
    <li
      className={cn("sidebar__menu-item", {
        "sidebar__menu-item--active": isActive,
        "sidebar__collection-item--drag-over": isDragOver,
      })}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        type="button"
        className="sidebar__menu-item-button sidebar__collection-item-button"
        onClick={handleClick}
        onContextMenu={handleRightClick}
      >
        <span className="sidebar__collection-icon">📂</span>
        <span className="sidebar__menu-item-button-label">
          {collection.name} ({collection.gameIds.length})
        </span>
      </button>

      <CollectionInfoModal
        collection={collection}
        isOpen={showModal}
        onClose={closeModal}
      />
    </li>
  );
}
