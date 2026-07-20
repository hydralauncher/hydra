import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AuthPage } from "@shared";
import {
  PlayIcon,
  DownloadIcon,
  HeartIcon,
  HeartFillIcon,
  PlusIcon,
  GearIcon,
  PencilIcon,
  FileDirectoryIcon,
  FileDirectoryFillIcon,
  LinkIcon,
  TrashIcon,
  XIcon,
  PinIcon,
  PinSlashIcon,
} from "@primer/octicons-react";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import {
  ContextMenu,
  ContextMenuItemData,
  ContextMenuProps,
  ConfirmationModal,
  CreateCollectionModal,
  useGameActions,
} from "..";
import { useGameCollections, useToast, useUserDetails } from "@renderer/hooks";
import { useCollectionContextMenu } from "@renderer/context";
import type { GameCollection } from "@types";
import type { GameContextMenuGame } from "./game-context-menu.types";

interface GameContextMenuProps extends Omit<ContextMenuProps, "items"> {
  game: GameContextMenuGame;
  onPinToggle?: () => void;
  isPinned?: boolean;
  onCollectionContextMenu?: (
    event: React.MouseEvent<HTMLElement>,
    collection: GameCollection
  ) => void;
}

const getGameCollectionIds = (currentGame: GameContextMenuGame): string[] => {
  if (Array.isArray(currentGame.collectionIds)) {
    return currentGame.collectionIds;
  }

  const legacyCollectionId = (currentGame as { collectionId?: string | null })
    .collectionId;

  return legacyCollectionId ? [legacyCollectionId] : [];
};

const FAVORITES_COLLECTION_ID = "__favorites__";

export function GameContextMenu({
  game,
  onPinToggle,
  isPinned,
  onCollectionContextMenu,
  visible,
  position,
  onClose,
}: GameContextMenuProps) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();
  const { userDetails } = useUserDetails();
  const [searchParams] = useSearchParams();
  const [showConfirmRemoveLibrary, setShowConfirmRemoveLibrary] =
    useState(false);
  const [showConfirmRemoveFiles, setShowConfirmRemoveFiles] = useState(false);
  const [showCreateCollectionModal, setShowCreateCollectionModal] =
    useState(false);
  const [localCollectionIds, setLocalCollectionIds] = useState<string[]>(() =>
    getGameCollectionIds(game)
  );
  const [isFavoriteSelected, setIsFavoriteSelected] = useState(
    Boolean(game.favorite)
  );
  const [pendingCollectionId, setPendingCollectionId] = useState<string | null>(
    null
  );
  const [isFavoritePending, setIsFavoritePending] = useState(false);
  const {
    collections,
    isLoading: isCollectionsLoading,
    loadCollections,
    assignGameToCollection,
  } = useGameCollections();
  const {
    canPlay,
    isDeleting,
    isGameDownloading,
    isGameRunning,
    hasRepacks,
    creatingShortcut,
    creatingSteamShortcut,
    handlePlayGame,
    handleCloseGame,
    handleToggleFavorite,
    handleCreateShortcut,
    handleCreateSteamShortcut,
    handleOpenFolder,
    handleOpenDownloadOptions,
    handleOpenDownloadLocation,
    handleTogglePin,
    handleRemoveFromLibrary,
    handleRemoveFiles,
    handleOpenGameOptions,
    rpcs3ConfirmPending,
    handleConfirmRpcs3Launch,
    handleCancelRpcs3Launch,
  } = useGameActions(game);
  const { isCollectionContextMenuOrModalOpen } = useCollectionContextMenu();
  const selectedCollectionId = searchParams.get("collection");

  useEffect(() => {
    if (!visible || game.shop === "custom" || !userDetails) return;
    void loadCollections();
  }, [visible, game.shop, loadCollections, userDetails]);

  useEffect(() => {
    if (!visible) return;

    setLocalCollectionIds(getGameCollectionIds(game));
    setIsFavoriteSelected(Boolean(game.favorite));
    setPendingCollectionId(null);
    setIsFavoritePending(false);
  }, [visible, game]);

  const handleAssignGameCollection = async (collectionId: string) => {
    if (pendingCollectionId || isFavoritePending) return;

    const isCurrentlyAssigned = localCollectionIds.includes(collectionId);
    const nextCollectionIds = isCurrentlyAssigned
      ? localCollectionIds.filter((id) => id !== collectionId)
      : [...localCollectionIds, collectionId];

    setPendingCollectionId(collectionId);

    try {
      await assignGameToCollection(game, nextCollectionIds);

      setLocalCollectionIds(nextCollectionIds);

      showSuccessToast(t("game_collection_updated"));

      if (isCurrentlyAssigned && selectedCollectionId === collectionId) {
        onClose();
      }
    } catch (error) {
      void error;
      showErrorToast(t("failed_update_game_collection"));
    } finally {
      setPendingCollectionId(null);
    }
  };

  const handleToggleFavoriteStatus = async () => {
    if (isFavoritePending || pendingCollectionId) return;

    const isAddingToFavorites = !isFavoriteSelected;

    setIsFavoritePending(true);

    try {
      await handleToggleFavorite(isFavoriteSelected);

      setIsFavoriteSelected((currentValue) => !currentValue);

      if (
        !isAddingToFavorites &&
        selectedCollectionId === FAVORITES_COLLECTION_ID
      ) {
        onClose();
      }
    } catch (error) {
      void error;
    } finally {
      setIsFavoritePending(false);
    }
  };

  const collectionSubmenu: ContextMenuItemData[] = [
    {
      id: "favorite",
      label: t("favorites", { ns: "sidebar" }),
      icon: isFavoriteSelected ? (
        <HeartFillIcon size={16} />
      ) : (
        <HeartIcon size={16} />
      ),
      onClick: () => {
        void handleToggleFavoriteStatus();
      },
      closeOnClick: false,
      disabled: isDeleting,
    },
    ...(game.shop === "custom"
      ? []
      : collections.map((collection) => ({
          id: `collection-${collection.id}`,
          label: collection.name,
          icon: localCollectionIds.includes(collection.id) ? (
            <FileDirectoryFillIcon size={16} />
          ) : (
            <FileDirectoryIcon size={16} />
          ),
          onClick: () => {
            void handleAssignGameCollection(collection.id);
          },
          onContextMenu: onCollectionContextMenu
            ? (event: React.MouseEvent<HTMLElement>) => {
                event.preventDefault();
                event.stopPropagation();
                onCollectionContextMenu(event, collection);
              }
            : undefined,
          closeOnClick: false,
          disabled: isDeleting,
        }))),
    ...(game.shop === "custom"
      ? []
      : [
          {
            id: "collection-create",
            label: t("create_collection"),
            icon: <PlusIcon size={16} />,
            separator: collections.length > 0,
            onClick: () => {
              if (!userDetails) {
                window.electron.openAuthWindow(AuthPage.SignIn);
                return;
              }

              setShowCreateCollectionModal(true);
            },
            closeOnClick: false,
            disabled: isDeleting || Boolean(pendingCollectionId),
          },
        ]),
  ];

  const items: ContextMenuItemData[] = [
    {
      id: "play",
      label: isGameRunning ? t("close") : canPlay ? t("play") : t("download"),
      icon: isGameRunning ? (
        <XIcon size={16} />
      ) : canPlay ? (
        <PlayIcon size={16} />
      ) : (
        <DownloadIcon size={16} />
      ),
      onClick: () => {
        if (isGameRunning) {
          void handleCloseGame();
        } else if (canPlay) {
          void handlePlayGame();
        } else {
          handleOpenDownloadOptions();
        }
      },
      disabled: isDeleting,
    },
    {
      id: "collection",
      label: t("collection"),
      icon: <FileDirectoryIcon size={16} />,
      onClick: () => {
        if (game.shop === "custom") return;
        void loadCollections();
      },
      disabled: isDeleting || isFavoritePending || Boolean(pendingCollectionId),
      submenu:
        isCollectionsLoading && game.shop !== "custom"
          ? [
              {
                id: "collection-loading",
                label: t("loading"),
                disabled: true,
              },
            ]
          : collectionSubmenu,
    },
    ...(game.executablePath
      ? [
          {
            id: "shortcuts",
            label: t("create_shortcut_simple"),
            icon: <LinkIcon size={16} />,
            disabled: isDeleting,
            submenu: [
              {
                id: "desktop-shortcut",
                label: t("create_shortcut_simple"),
                icon: <LinkIcon size={16} />,
                onClick: handleCreateShortcut,
                disabled: isDeleting || creatingShortcut,
              },
              {
                id: "steam-shortcut",
                label: t("create_steam_shortcut"),
                icon: <SteamLogo style={{ width: 16, height: 16 }} />,
                onClick: handleCreateSteamShortcut,
                disabled: isDeleting || creatingSteamShortcut,
              },
            ],
          },
        ]
      : []),

    {
      id: "manage",
      label: t("options"),
      icon: <GearIcon size={16} />,
      disabled: isDeleting,
      submenu: [
        {
          id: "pin-game",
          label:
            (isPinned ?? game.isPinned ?? false)
              ? t("unpin_game")
              : t("pin_game"),
          icon:
            (isPinned ?? game.isPinned ?? false) ? (
              <PinSlashIcon size={16} />
            ) : (
              <PinIcon size={16} />
            ),
          onClick: onPinToggle ?? handleTogglePin,
          disabled: isDeleting,
        },
        ...(game.executablePath
          ? [
              {
                id: "open-folder",
                label: t("open_folder"),
                icon: <FileDirectoryIcon size={16} />,
                onClick: handleOpenFolder,
                disabled: isDeleting,
              },
            ]
          : []),
        ...(game.executablePath
          ? [
              {
                id: "download-options",
                label: t("open_download_options"),
                icon: <PlayIcon size={16} />,
                onClick: handleOpenDownloadOptions,
                disabled: isDeleting || isGameDownloading || !hasRepacks,
              },
            ]
          : []),
        ...(game.download?.downloadPath
          ? [
              {
                id: "download-location",
                label: t("open_download_location"),
                icon: <FileDirectoryIcon size={16} />,
                onClick: handleOpenDownloadLocation,
                disabled: isDeleting,
              },
            ]
          : []),

        {
          id: "remove-library",
          label: t("remove_from_library"),
          icon: <XIcon size={16} />,
          onClick: () => setShowConfirmRemoveLibrary(true),
          disabled: isDeleting,
          danger: true,
          closeOnClick: false,
        },
        ...(game.download?.downloadPath
          ? [
              {
                id: "remove-files",
                label: t("remove_files"),
                icon: <TrashIcon size={16} />,
                onClick: () => setShowConfirmRemoveFiles(true),
                disabled: isDeleting || isGameDownloading,
                danger: true,
                closeOnClick: false,
              },
            ]
          : []),
      ],
    },
    {
      id: "properties",
      label: t("properties"),
      separator: true,
      icon: <PencilIcon size={16} />,
      onClick: () => handleOpenGameOptions(),
      disabled: isDeleting,
    },
  ];

  return (
    <>
      <ContextMenu
        items={items}
        visible={visible}
        position={position}
        onClose={onClose}
        forceOpenSubmenuId={
          showConfirmRemoveLibrary || showConfirmRemoveFiles
            ? "manage"
            : isCollectionContextMenuOrModalOpen || showCreateCollectionModal
              ? "collection"
              : undefined
        }
        className={
          !game.executablePath ? "context-menu--game-not-installed" : undefined
        }
      />

      <CreateCollectionModal
        visible={showCreateCollectionModal}
        onClose={() => setShowCreateCollectionModal(false)}
        onCreated={(collection) => {
          void (async () => {
            const nextCollectionIds = Array.from(
              new Set([...localCollectionIds, collection.id])
            );

            setPendingCollectionId(collection.id);

            try {
              await assignGameToCollection(game, nextCollectionIds);
              setLocalCollectionIds(nextCollectionIds);
              showSuccessToast(t("game_collection_updated"));
            } catch (error) {
              void error;
              showErrorToast(t("failed_update_game_collection"));
            } finally {
              setPendingCollectionId(null);
            }
          })();
        }}
      />

      <ConfirmationModal
        visible={showConfirmRemoveLibrary}
        title={t("remove_from_library_title")}
        descriptionText={t("remove_from_library_description", {
          game: game.title,
        })}
        onClose={() => {
          setShowConfirmRemoveLibrary(false);
        }}
        onConfirm={async () => {
          setShowConfirmRemoveLibrary(false);
          onClose();
          await handleRemoveFromLibrary();
        }}
        cancelButtonLabel={t("cancel")}
        confirmButtonLabel={t("remove")}
      />

      <ConfirmationModal
        visible={showConfirmRemoveFiles}
        title={t("remove_files")}
        descriptionText={t("delete_modal_description", { ns: "downloads" })}
        onClose={() => {
          setShowConfirmRemoveFiles(false);
        }}
        onConfirm={async () => {
          setShowConfirmRemoveFiles(false);
          onClose();
          await handleRemoveFiles();
        }}
        cancelButtonLabel={t("cancel")}
        confirmButtonLabel={t("remove")}
      />

      <ConfirmationModal
        visible={rpcs3ConfirmPending !== null}
        title={t("rpcs3_already_running_title")}
        descriptionText={t("rpcs3_already_running_description")}
        confirmButtonLabel={t("rpcs3_already_running_confirm")}
        cancelButtonLabel={t("cancel")}
        onClose={handleCancelRpcs3Launch}
        onConfirm={handleConfirmRpcs3Launch}
      />
    </>
  );
}
