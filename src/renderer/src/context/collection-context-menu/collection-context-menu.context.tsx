import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { GameCollection } from "@types";
import { useGameCollections, useLibrary, useToast } from "@renderer/hooks";
import {
  Button,
  ConfirmationModal,
  ContextMenu,
  Modal,
  TextField,
} from "@renderer/components";
import { PencilIcon, TrashIcon } from "@primer/octicons-react";

import "./collection-context-menu.context.scss";

export interface CollectionContextMenuContextValue {
  openCollectionContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    collection: GameCollection
  ) => void;
  isCollectionContextMenuOrModalOpen: boolean;
}

const CollectionContextMenuContext =
  createContext<CollectionContextMenuContextValue | null>(null);

export const useCollectionContextMenu = () => {
  const ctx = useContext(CollectionContextMenuContext);

  if (!ctx) {
    throw new Error(
      "useCollectionContextMenu must be used within CollectionContextMenuProvider"
    );
  }

  return ctx;
};

export interface CollectionContextMenuProviderProps {
  children: React.ReactNode;
}

export function CollectionContextMenuProvider({
  children,
}: CollectionContextMenuProviderProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation("library");
  const { showSuccessToast, showErrorToast } = useToast();
  const { loadCollections } = useGameCollections();
  const { updateLibrary } = useLibrary();

  const [collectionContextMenu, setCollectionContextMenu] = useState<{
    collection: GameCollection | null;
    visible: boolean;
    position: { x: number; y: number };
  }>({ collection: null, visible: false, position: { x: 0, y: 0 } });

  const [activeCollection, setActiveCollection] =
    useState<GameCollection | null>(null);
  const [showRenameCollectionModal, setShowRenameCollectionModal] =
    useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [isRenamingCollection, setIsRenamingCollection] = useState(false);
  const [showDeleteCollectionModal, setShowDeleteCollectionModal] =
    useState(false);
  const [isDeletingCollection, setIsDeletingCollection] = useState(false);

  const selectedCollectionId = searchParams.get("collection");

  const handleOpenCollectionContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>, collection: GameCollection) => {
      event.preventDefault();
      event.stopPropagation();

      setCollectionContextMenu({
        collection,
        visible: true,
        position: { x: event.clientX, y: event.clientY },
      });
    },
    []
  );

  const handleCloseCollectionContextMenu = useCallback(() => {
    setCollectionContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  const resolveCollectionErrorMessage = useCallback(
    (
      error: unknown,
      fallbackKey: "failed_rename_collection" | "failed_delete_collection"
    ) => {
      if (!(error instanceof Error)) return t(fallbackKey);

      if (error.message.includes("game/collection-name-already-in-use")) {
        return t("collection_name_already_in_use", { ns: "sidebar" });
      }

      if (error.message.includes("game/collection-name-required")) {
        return t("collection_name_required", { ns: "sidebar" });
      }

      return t(fallbackKey);
    },
    [t]
  );

  const handleOpenRenameCollectionModal = useCallback(() => {
    const collection = collectionContextMenu.collection;
    if (!collection) return;

    setActiveCollection(collection);
    setCollectionName(collection.name);
    setShowRenameCollectionModal(true);
  }, [collectionContextMenu.collection]);

  const handleCloseRenameCollectionModal = useCallback(() => {
    if (isRenamingCollection) return;

    setShowRenameCollectionModal(false);
    setCollectionName("");
    setActiveCollection(null);
  }, [isRenamingCollection]);

  const handleRenameCollection = useCallback(async () => {
    if (!activeCollection) return;

    const nextName = collectionName.trim();
    if (!nextName) {
      showErrorToast(t("collection_name_required", { ns: "sidebar" }));
      return;
    }

    if (nextName === activeCollection.name.trim()) {
      handleCloseRenameCollectionModal();
      return;
    }

    setIsRenamingCollection(true);

    try {
      await window.electron.hydraApi.put(
        `/profile/games/collections/${activeCollection.id}`,
        {
          data: { name: nextName },
          needsAuth: true,
        }
      );

      await loadCollections();
      showSuccessToast(t("collection_renamed"));
      handleCloseRenameCollectionModal();
    } catch (error) {
      showErrorToast(
        resolveCollectionErrorMessage(error, "failed_rename_collection")
      );
    } finally {
      setIsRenamingCollection(false);
    }
  }, [
    activeCollection,
    collectionName,
    handleCloseRenameCollectionModal,
    loadCollections,
    resolveCollectionErrorMessage,
    showErrorToast,
    showSuccessToast,
    t,
  ]);

  const handleOpenDeleteCollectionModal = useCallback(() => {
    const collection = collectionContextMenu.collection;
    if (!collection) return;

    setActiveCollection(collection);
    setShowDeleteCollectionModal(true);
  }, [collectionContextMenu.collection]);

  const handleCloseDeleteCollectionModal = useCallback(() => {
    if (isDeletingCollection) return;

    setShowDeleteCollectionModal(false);
    setActiveCollection(null);
  }, [isDeletingCollection]);

  const handleCollectionSelect = useCallback(
    (collectionId: string | null) => {
      const params = new URLSearchParams(searchParams);

      if (collectionId) {
        params.set("collection", collectionId);
      } else {
        params.delete("collection");
      }

      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleDeleteCollection = useCallback(async () => {
    if (!activeCollection) return;

    setIsDeletingCollection(true);

    try {
      await window.electron.hydraApi.delete(
        `/profile/games/collections/${activeCollection.id}`,
        { needsAuth: true }
      );

      if (selectedCollectionId === activeCollection.id) {
        handleCollectionSelect(null);
      }

      await Promise.all([loadCollections(), updateLibrary()]);
      showSuccessToast(t("collection_deleted"));
      handleCloseDeleteCollectionModal();
    } catch (error) {
      showErrorToast(
        resolveCollectionErrorMessage(error, "failed_delete_collection")
      );
    } finally {
      setIsDeletingCollection(false);
    }
  }, [
    activeCollection,
    selectedCollectionId,
    handleCollectionSelect,
    loadCollections,
    updateLibrary,
    showSuccessToast,
    t,
    handleCloseDeleteCollectionModal,
    showErrorToast,
    resolveCollectionErrorMessage,
  ]);

  const collectionContextMenuItems = useMemo(() => {
    const isCollectionActionBusy = isRenamingCollection || isDeletingCollection;

    return [
      {
        id: "rename-collection",
        label: t("rename_collection"),
        icon: <PencilIcon size={16} />,
        onClick: handleOpenRenameCollectionModal,
        disabled: isCollectionActionBusy,
      },
      {
        id: "delete-collection",
        label: t("delete_collection"),
        icon: <TrashIcon size={16} />,
        onClick: handleOpenDeleteCollectionModal,
        danger: true,
        disabled: isCollectionActionBusy,
      },
    ];
  }, [
    handleOpenDeleteCollectionModal,
    handleOpenRenameCollectionModal,
    isDeletingCollection,
    isRenamingCollection,
    t,
  ]);

  const contextValue = useMemo(
    () => ({
      openCollectionContextMenu: handleOpenCollectionContextMenu,
      isCollectionContextMenuOrModalOpen:
        collectionContextMenu.visible ||
        showRenameCollectionModal ||
        showDeleteCollectionModal,
    }),
    [
      handleOpenCollectionContextMenu,
      collectionContextMenu.visible,
      showRenameCollectionModal,
      showDeleteCollectionModal,
    ]
  );

  return (
    <CollectionContextMenuContext.Provider value={contextValue}>
      {children}
      <ContextMenu
        items={collectionContextMenuItems}
        visible={collectionContextMenu.visible}
        position={collectionContextMenu.position}
        onClose={handleCloseCollectionContextMenu}
      />
      <Modal
        visible={showRenameCollectionModal}
        title={t("rename_collection")}
        description={t("rename_collection_description")}
        onClose={handleCloseRenameCollectionModal}
      >
        <div className="collection-context-menu__modal">
          <TextField
            label={t("collection_name", { ns: "sidebar" })}
            placeholder={t("collection_name_placeholder", { ns: "sidebar" })}
            value={collectionName}
            onChange={(event) => setCollectionName(event.target.value)}
            theme="dark"
            disabled={isRenamingCollection}
            maxLength={60}
          />
          <div className="collection-context-menu__modal-actions">
            <Button
              type="button"
              theme="outline"
              onClick={handleCloseRenameCollectionModal}
              disabled={isRenamingCollection}
            >
              {t("cancel", { ns: "sidebar" })}
            </Button>
            <Button
              type="button"
              theme="primary"
              onClick={handleRenameCollection}
              disabled={!collectionName.trim() || isRenamingCollection}
            >
              {isRenamingCollection
                ? t("renaming_collection")
                : t("rename_collection")}
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmationModal
        visible={showDeleteCollectionModal}
        title={t("delete_collection_title")}
        descriptionText={t("delete_collection_description", {
          collectionName: activeCollection?.name ?? "",
        })}
        onClose={handleCloseDeleteCollectionModal}
        onConfirm={() => {
          void handleDeleteCollection();
        }}
        cancelButtonLabel={t("cancel", { ns: "sidebar" })}
        confirmButtonLabel={t("delete_collection")}
        buttonsIsDisabled={isDeletingCollection}
      />
    </CollectionContextMenuContext.Provider>
  );
}
