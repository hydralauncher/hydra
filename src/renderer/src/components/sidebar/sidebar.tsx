import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Tooltip } from "react-tooltip";

import type { GameCollection, LibraryGame } from "@types";

import {
  Button,
  TextField,
  ConfirmationModal,
  ContextMenu,
  CreateCollectionModal,
  Modal,
} from "@renderer/components";
import {
  useDownload,
  useGameCollections,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { AuthPage } from "@shared";

import "./sidebar.scss";

import { buildGameDetailsPath } from "@renderer/helpers";

import { sortBy } from "lodash-es";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import cn from "classnames";
import {
  CommentDiscussionIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  TrophyIcon,
  PeopleIcon,
  CloudIcon,
} from "@primer/octicons-react";
import { ArrowRightLeft as ArrowRightLeftIcon } from "lucide-react";

import { SidebarAddingCustomGameModal } from "./sidebar-adding-custom-game-modal";
import { SidebarFavoriteCard } from "./sidebar-favorite-card";
import { SidebarGameRunning } from "./sidebar-game-running";
import { SidebarActiveDownload } from "./sidebar-active-download";
import { SidebarOnlineFriends } from "./sidebar-online-friends";
import { setFriendRequestCount } from "@renderer/features/user-details-slice";
import { setCollections } from "@renderer/features";
import { useDispatch } from "react-redux";

const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_INITIAL_WIDTH = 300;
const SIDEBAR_MAX_WIDTH = 500;

const initialSidebarWidth = window.localStorage.getItem("sidebarWidth");

const isGamePlayable = (game: LibraryGame) => Boolean(game.executablePath);

export function Sidebar() {
  const filterRef = useRef<HTMLInputElement>(null);

  const dispatch = useDispatch();

  const { t } = useTranslation(["sidebar", "library"]);
  const { library, updateLibrary } = useLibrary();
  const [deckyPluginInfo, setDeckyPluginInfo] = useState<{
    installed: boolean;
    version: string | null;
    outdated: boolean;
  }>({ installed: false, version: null, outdated: false });

  const [showDeckyConfirmModal, setShowDeckyConfirmModal] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = initialSidebarWidth
      ? Number(initialSidebarWidth)
      : SIDEBAR_INITIAL_WIDTH;
    return Math.max(stored, SIDEBAR_MIN_WIDTH);
  });

  const location = useLocation();

  const sortedLibrary = useMemo(() => {
    return sortBy(library, (game) => game.title);
  }, [library]);

  const { hasActiveSubscription, userDetails } = useUserDetails();

  const { lastPacket } = useDownload();

  const { showWarningToast, showSuccessToast, showErrorToast } = useToast();

  const [showInstalledGames, setShowInstalledGames] = useState(false);
  const [showAddGameModal, setShowAddGameModal] = useState(false);
  const [onlineFriendsCount, setOnlineFriendsCount] = useState(0);
  const [totalAchievements, setTotalAchievements] = useState(0);

  useEffect(() => {
    if (!userDetails?.id) {
      setOnlineFriendsCount(0);
      setTotalAchievements(0);
      return;
    }

    window.electron.hydraApi
      .get<{ friends?: { currentGame: any }[] }>("/profile/friends", {
        params: { take: 100, skip: 0 },
      })
      .then((data) => {
        if (data?.friends) {
          setOnlineFriendsCount(
            data.friends.filter((f) => f.currentGame).length
          );
        }
      })
      .catch(() => {});

    window.electron.hydraApi
      .get<any>(`/users/${userDetails.id}/stats`)
      .then((data) => {
        if (data?.unlockedAchievementSum) {
          setTotalAchievements(data.unlockedAchievementSum);
        }
      })
      .catch(() => {});
  }, [userDetails?.id]);

  useEffect(() => {
    const handleTestFriend = () => setOnlineFriendsCount((prev) => prev + 1);
    window.addEventListener("hydra:test-friend", handleTestFriend);
    return () =>
      window.removeEventListener("hydra:test-friend", handleTestFriend);
  }, []);

  const [showCreateCollectionModal, setShowCreateCollectionModal] =
    useState(false);
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
  const { hasLoaded: hasLoadedCollections, loadCollections } =
    useGameCollections();

  const selectedCollectionId = useMemo(() => {
    if (!location.pathname.startsWith("/library")) return null;
    return searchParams.get("collection");
  }, [location.pathname, searchParams]);

  const handleAddGameButtonClick = () => {
    setShowAddGameModal(true);
  };

  const handleCloseAddGameModal = () => {
    setShowAddGameModal(false);
  };

  const loadDeckyPluginInfo = async () => {
    if (window.electron.platform !== "linux") return;

    try {
      const [info] = await Promise.all([
        window.electron.getHydraDeckyPluginInfo(),
        window.electron.checkHomebrewFolderExists(),
      ]);

      setDeckyPluginInfo({
        installed: info.installed,
        version: info.version,
        outdated: info.outdated,
      });
    } catch (error) {
      console.error("Failed to load Decky plugin info:", error);
    }
  };

  const handleConfirmDeckyInstallation = async () => {
    setShowDeckyConfirmModal(false);

    try {
      const result = await window.electron.installHydraDeckyPlugin();

      if (result.success) {
        showSuccessToast(
          t("decky_plugin_installed", {
            version: result.currentVersion,
          })
        );
        await loadDeckyPluginInfo();
      } else {
        showErrorToast(
          t("decky_plugin_installation_failed", {
            error: result.error || "Unknown error",
          })
        );
      }
    } catch (error) {
      showErrorToast(
        t("decky_plugin_installation_error", { error: String(error) })
      );
    }
  };

  useEffect(() => {
    updateLibrary();
  }, [lastPacket?.gameId, updateLibrary]);

  useEffect(() => {
    loadDeckyPluginInfo();
  }, []);

  useEffect(() => {
    if (!userDetails || hasLoadedCollections) return;
    void loadCollections();
  }, [hasLoadedCollections, loadCollections, userDetails]);

  useEffect(() => {
    const unsubscribe = window.electron.onSyncFriendRequests((result) => {
      dispatch(setFriendRequestCount(result.friendRequestCount));
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch]);

  const sidebarRef = useRef<HTMLElement>(null);

  const cursorPos = useRef({ x: 0 });
  const sidebarInitialWidth = useRef(0);

  const handleMouseDown: React.MouseEventHandler<HTMLButtonElement> = (
    event
  ) => {
    setIsResizing(true);
    cursorPos.current.x = event.screenX;
    sidebarInitialWidth.current =
      sidebarRef.current?.clientWidth || SIDEBAR_INITIAL_WIDTH;
  };

  useEffect(() => {
    if (filterRef.current) {
      filterRef.current.value = "";
    }
  }, [sortedLibrary]);

  useEffect(() => {
    window.onmousemove = (event: MouseEvent) => {
      if (isResizing) {
        const cursorXDelta = event.screenX - cursorPos.current.x;
        const newWidth = Math.max(
          SIDEBAR_MIN_WIDTH,
          Math.min(
            sidebarInitialWidth.current + cursorXDelta,
            SIDEBAR_MAX_WIDTH
          )
        );

        setSidebarWidth(newWidth);
        window.localStorage.setItem("sidebarWidth", String(newWidth));
      }
    };

    window.onmouseup = () => {
      if (isResizing) setIsResizing(false);
    };

    return () => {
      window.onmouseup = null;
      window.onmousemove = null;
    };
  }, [isResizing]);

  const handleSidebarGameClick = (
    event: React.MouseEvent,
    game: LibraryGame
  ) => {
    const path = buildGameDetailsPath({
      ...game,
      objectId: game.objectId,
    });
    if (path !== location.pathname) {
      navigate(path);
    }

    if (event.detail === 2) {
      if (game.executablePath) {
        window.electron.openGame(
          game.shop,
          game.objectId,
          game.executablePath,
          game.launchOptions
        );
      } else {
        showWarningToast(t("game_has_no_executable"));
      }
    }
  };

  const handleCloseCollectionContextMenu = () => {
    setCollectionContextMenu((prev) => ({ ...prev, visible: false }));
  };

  const resolveCollectionErrorMessage = (
    error: unknown,
    fallbackKey: "failed_rename_collection" | "failed_delete_collection"
  ) => {
    if (!(error instanceof Error)) return t(fallbackKey, { ns: "library" });

    if (error.message.includes("game/collection-name-already-in-use")) {
      return t("collection_name_already_in_use");
    }

    if (error.message.includes("game/collection-name-required")) {
      return t("collection_name_required");
    }

    return t(fallbackKey, { ns: "library" });
  };

  const handleOpenRenameCollectionModal = () => {
    const collection = collectionContextMenu.collection;
    if (!collection) return;

    setActiveCollection(collection);
    setCollectionName(collection.name);
    setShowRenameCollectionModal(true);
    handleCloseCollectionContextMenu();
  };

  const handleCloseRenameCollectionModal = () => {
    if (isRenamingCollection) return;

    setShowRenameCollectionModal(false);
    setCollectionName("");
    setActiveCollection(null);
  };

  const handleRenameCollection = async () => {
    const targetCollection =
      activeCollection ?? collectionContextMenu.collection;
    if (!targetCollection) return;

    const nextName = collectionName.trim();
    if (!nextName) {
      showErrorToast(t("collection_name_required"));
      return;
    }

    if (nextName === targetCollection.name.trim()) {
      handleCloseRenameCollectionModal();
      return;
    }

    setIsRenamingCollection(true);

    try {
      await window.electron.hydraApi.put(
        `/profile/games/collections/${targetCollection.id}`,
        {
          data: { name: nextName },
          needsAuth: true,
        }
      );

      const updatedCollections = await window.electron.hydraApi.get<
        GameCollection[]
      >("/profile/games/collections", { needsAuth: true });
      dispatch(setCollections(updatedCollections));
      showSuccessToast(t("collection_renamed", { ns: "library" }));
      handleCloseRenameCollectionModal();
    } catch (error) {
      showErrorToast(
        resolveCollectionErrorMessage(error, "failed_rename_collection")
      );
    } finally {
      setIsRenamingCollection(false);
    }
  };

  const handleOpenDeleteCollectionModal = () => {
    const collection = collectionContextMenu.collection;
    if (!collection) return;

    setActiveCollection(collection);
    setShowDeleteCollectionModal(true);
    handleCloseCollectionContextMenu();
  };

  const handleCloseDeleteCollectionModal = () => {
    if (isDeletingCollection) return;

    setShowDeleteCollectionModal(false);
    setActiveCollection(null);
  };

  const handleDeleteCollection = async () => {
    const targetCollection =
      activeCollection ?? collectionContextMenu.collection;
    if (!targetCollection) return;

    setIsDeletingCollection(true);

    try {
      await window.electron.hydraApi.delete(
        `/profile/games/collections/${targetCollection.id}`,
        { needsAuth: true }
      );

      if (selectedCollectionId === targetCollection.id) {
        const params = new URLSearchParams(searchParams);
        params.delete("collection");
        setSearchParams(params, { replace: true });
      }

      const updatedCollectionsPromise = window.electron.hydraApi.get<
        GameCollection[]
      >("/profile/games/collections", { needsAuth: true });
      await updateLibrary();
      const updatedCollections = await updatedCollectionsPromise;
      dispatch(setCollections(updatedCollections));
      showSuccessToast(t("collection_deleted", { ns: "library" }));
      handleCloseDeleteCollectionModal();
    } catch (error) {
      showErrorToast(
        resolveCollectionErrorMessage(error, "failed_delete_collection")
      );
    } finally {
      setIsDeletingCollection(false);
    }
  };

  const collectionContextMenuItems = useMemo(() => {
    const isCollectionActionBusy = isRenamingCollection || isDeletingCollection;

    return [
      {
        id: "rename-collection",
        label: t("rename_collection", { ns: "library" }),
        icon: <PencilIcon size={16} />,
        onClick: handleOpenRenameCollectionModal,
        disabled: isCollectionActionBusy,
      },
      {
        id: "delete-collection",
        label: t("delete_collection", { ns: "library" }),
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

  const favoriteGames = useMemo(() => {
    return sortedLibrary.filter((game) => game.favorite);
  }, [sortedLibrary]);

  const installedGames = useMemo(() => {
    return sortedLibrary.filter(isGamePlayable);
  }, [sortedLibrary]);

  return (
    <div className="sidebar-wrapper">
      <aside
        ref={sidebarRef}
        className={cn("sidebar", {
          "sidebar--resizing": isResizing,
          "sidebar--darwin": window.electron.platform === "darwin",
        })}
        style={{
          width: sidebarWidth,
        }}
      >
        <div className="sidebar__container">
          <div className="sidebar__brand">
            <HydraIcon className="sidebar__brand-icon" />
            <h1 className="sidebar__brand-name">HYDRA</h1>
          </div>
          <div className="sidebar__content">
            {/* ── Nav·Links rápidos ── */}
            <nav className="sidebar__nav-links">
              {import.meta.env.DEV && (
                <button
                  type="button"
                  className="sidebar__nav-link"
                  onClick={() => navigate("/achievements")}
                >
                  <TrophyIcon size={14} />
                  <span>Conquistas</span>
                  {totalAchievements > 0 && (
                    <small className="sidebar__nav-link-badge">
                      {totalAchievements}
                    </small>
                  )}
                </button>
              )}
              <button
                type="button"
                className="sidebar__nav-link"
                onClick={() =>
                  userDetails
                    ? navigate(`/profile/${userDetails.id}`)
                    : window.electron.openAuthWindow(AuthPage.SignIn)
                }
              >
                <PeopleIcon size={14} />
                <span>Amigos</span>
                {onlineFriendsCount > 0 && (
                  <small className="sidebar__nav-link-badge">
                    {onlineFriendsCount > 99 ? "99+" : onlineFriendsCount}
                  </small>
                )}
              </button>
              <button
                type="button"
                className="sidebar__nav-link"
                onClick={() =>
                  hasActiveSubscription
                    ? navigate("/settings")
                    : window.electron.openExternal(
                        "https://checkout.hydralauncher.gg"
                      )
                }
              >
                <CloudIcon size={14} />
                <span>Hydra Cloud</span>
              </button>
            </nav>

            <div className="sidebar__divider" />

            <SidebarGameRunning />
            <SidebarActiveDownload />
            <SidebarOnlineFriends />

            {/* ── Toggle Favoritos / Instalados ── */}
            <div className="sidebar__game-toggle">
              <button
                type="button"
                className="sidebar__game-toggle-btn"
                onClick={() => setShowInstalledGames(!showInstalledGames)}
              >
                <div
                  key={showInstalledGames ? "installed" : "favorites"}
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <div className="sidebar__game-toggle-text">
                    {(showInstalledGames
                      ? t("installed", { defaultValue: "Instalados" })
                      : t("favorites", { defaultValue: "Favoritos" })
                    )
                      .split("")
                      .map((char, index) => (
                        <span
                          key={index}
                          className="sidebar__game-toggle-letter"
                          style={{ animationDelay: `${index * 25}ms` }}
                        >
                          {char === " " ? "\u00A0" : char}
                        </span>
                      ))}
                  </div>
                  <div
                    className={cn("sidebar__game-toggle-icon", {
                      "sidebar__game-toggle-icon--installed":
                        showInstalledGames,
                    })}
                  >
                    <ArrowRightLeftIcon size={12} />
                  </div>
                </div>
                <span className="sidebar__game-toggle-count">
                  {showInstalledGames
                    ? installedGames.length
                    : favoriteGames.length}
                </span>
              </button>

              <div
                key={showInstalledGames ? "installed" : "favorites"}
                className="sidebar__favorites-list"
              >
                {(showInstalledGames ? installedGames : favoriteGames)
                  .length === 0 ? (
                  <p className="sidebar__menu-empty">
                    {showInstalledGames
                      ? t("no_installed_games", {
                          defaultValue: "Nenhum jogo instalado",
                        })
                      : t("no_favorites", {
                          defaultValue: "Nenhum jogo favorito",
                        })}
                  </p>
                ) : (
                  (showInstalledGames ? installedGames : favoriteGames).map(
                    (game) => (
                      <SidebarFavoriteCard
                        key={game.id}
                        game={game}
                        onClick={handleSidebarGameClick}
                      />
                    )
                  )
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="sidebar__bottom-buttons">
          <button
            type="button"
            className="sidebar__add-game-button"
            onClick={handleAddGameButtonClick}
          >
            <PlusIcon size={14} />
            <span>
              {t("add_custom_game_tooltip", { defaultValue: "Adicionar jogo" })}
            </span>
          </button>

          {hasActiveSubscription && (
            <button
              type="button"
              className="sidebar__help-button"
              data-open-support-chat
            >
              <div className="sidebar__help-button-icon">
                <CommentDiscussionIcon size={14} />
              </div>
              <span>{t("need_help")}</span>
            </button>
          )}
        </div>

        <button
          type="button"
          className="sidebar__handle"
          onMouseDown={handleMouseDown}
        />

        <SidebarAddingCustomGameModal
          visible={showAddGameModal}
          onClose={handleCloseAddGameModal}
        />

        <CreateCollectionModal
          visible={showCreateCollectionModal}
          onClose={() => setShowCreateCollectionModal(false)}
        />

        <ContextMenu
          items={collectionContextMenuItems}
          visible={collectionContextMenu.visible}
          position={collectionContextMenu.position}
          onClose={handleCloseCollectionContextMenu}
        />

        <Modal
          visible={showRenameCollectionModal}
          title={t("rename_collection", { ns: "library" })}
          description={t("rename_collection_description", { ns: "library" })}
          onClose={handleCloseRenameCollectionModal}
        >
          <div className="sidebar__collection-modal">
            <TextField
              label={t("collection_name")}
              placeholder={t("collection_name_placeholder")}
              value={collectionName}
              onChange={(event) => setCollectionName(event.target.value)}
              theme="dark"
              disabled={isRenamingCollection}
              maxLength={60}
            />

            <div className="sidebar__collection-modal-actions">
              <Button
                type="button"
                theme="outline"
                onClick={handleCloseRenameCollectionModal}
                disabled={isRenamingCollection}
              >
                {t("cancel")}
              </Button>

              <Button
                type="button"
                theme="primary"
                onClick={() => {
                  void handleRenameCollection();
                }}
                disabled={!collectionName.trim() || isRenamingCollection}
              >
                {isRenamingCollection
                  ? t("renaming_collection", { ns: "library" })
                  : t("rename_collection", { ns: "library" })}
              </Button>
            </div>
          </div>
        </Modal>

        <ConfirmationModal
          visible={showDeleteCollectionModal}
          title={t("delete_collection_title", { ns: "library" })}
          descriptionText={t("delete_collection_description", {
            ns: "library",
            collectionName: activeCollection?.name ?? "",
          })}
          onClose={handleCloseDeleteCollectionModal}
          onConfirm={() => {
            void handleDeleteCollection();
          }}
          cancelButtonLabel={t("cancel")}
          confirmButtonLabel={t("delete_collection", { ns: "library" })}
          buttonsIsDisabled={isDeletingCollection}
        />

        <ConfirmationModal
          visible={showDeckyConfirmModal}
          title={
            deckyPluginInfo.installed && deckyPluginInfo.outdated
              ? t("update_decky_plugin_title")
              : t("install_decky_plugin_title")
          }
          descriptionText={
            deckyPluginInfo.installed && deckyPluginInfo.outdated
              ? t("update_decky_plugin_message")
              : t("install_decky_plugin_message")
          }
          onClose={() => setShowDeckyConfirmModal(false)}
          onConfirm={handleConfirmDeckyInstallation}
          cancelButtonLabel={t("cancel")}
          confirmButtonLabel={t("confirm")}
        />

        <Tooltip id="add-custom-game-tooltip" />
        <Tooltip id="create-collection-tooltip" />
        <Tooltip id="show-playable-only-tooltip" />
      </aside>
    </div>
  );
}
