import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import type { LibraryGame } from "@types";

import { TextField, FolderIcon } from "@renderer/components";
import { CreateGamesFolder } from "@renderer/components/create-games-folder";
import {
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
  useAppSelector,
} from "@renderer/hooks";
import { useGameFolders } from "@renderer/hooks/use-game-folders";

import { routes } from "./routes";

import "./sidebar.scss";

import { buildGameDetailsPath } from "@renderer/helpers";

import { SidebarProfile } from "./sidebar-profile";
import { sortBy } from "lodash-es";
import cn from "classnames";
import {
  CommentDiscussionIcon,
  PlayIcon,
  FileDirectoryIcon,
  AppsIcon,
} from "@primer/octicons-react";
import { SidebarGameItem } from "./sidebar-game-item";
import { setFriendRequestCount } from "@renderer/features/user-details-slice";
import { useDispatch } from "react-redux";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_INITIAL_WIDTH = 250;
const SIDEBAR_MAX_WIDTH = 450;

const initialSidebarWidth = window.localStorage.getItem("sidebarWidth");

const isGamePlayable = (game: LibraryGame) => Boolean(game.executablePath);

export function Sidebar() {
  const filterRef = useRef<HTMLInputElement>(null);

  const dispatch = useDispatch();

  const { t } = useTranslation("sidebar");
  const { library, updateLibrary } = useLibrary();
  const { folders, getUnorganizedGameIds, moveGameBetweenFolders } =
    useGameFolders();
  const navigate = useNavigate();

  const [filteredLibrary, setFilteredLibrary] = useState<LibraryGame[]>([]);

  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(
    initialSidebarWidth ? Number(initialSidebarWidth) : SIDEBAR_INITIAL_WIDTH
  );

  const location = useLocation();

  const sortedLibrary = useMemo(() => {
    return sortBy(library, (game) => game.title);
  }, [library]);

  const { hasActiveSubscription } = useUserDetails();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { lastPacket, progress } = useDownload();

  const { showWarningToast } = useToast();

  const [showPlayableOnly, setShowPlayableOnly] = useState(false);
  const [showCreateGamesFolder, setShowCreateGamesFolder] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set()
  );
  const [draggedGameId, setDraggedGameId] = useState<string | null>(null);
  const [isCustomFoldersExpanded, setIsCustomFoldersExpanded] = useState(true);

  const handlePlayButtonClick = () => {
    setShowPlayableOnly(!showPlayableOnly);
  };

  useEffect(() => {
    updateLibrary();
  }, [lastPacket?.gameId, updateLibrary]);

  useEffect(() => {
    if (!window.electron) return;

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

  const handleFilter: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    setFilteredLibrary(
      sortedLibrary.filter((game) =>
        game.title
          .toLowerCase()
          .includes(event.target.value.toLocaleLowerCase())
      )
    );
  };

  useEffect(() => {
    setFilteredLibrary(sortedLibrary);

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

  const getGameTitle = (game: LibraryGame) => {
    if (lastPacket?.gameId === game.id) {
      return t("downloading", {
        title: game.title,
        percentage: progress,
      });
    }

    if (game.download?.queued) return t("queued", { title: game.title });

    if (game.download?.status === "paused")
      return t("paused", { title: game.title });

    return game.title;
  };

  const handleSidebarItemClick = (path: string) => {
    if (path !== location.pathname) {
      navigate(path);
    }
  };

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
      if (game.executablePath && window.electron) {
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

  const favoriteGames = useMemo(() => {
    return sortedLibrary.filter((game) => game.favorite);
  }, [sortedLibrary]);

  const toggleFolderExpansion = (folderId: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  const toggleCustomFoldersExpansion = () => {
    setIsCustomFoldersExpanded(!isCustomFoldersExpanded);
  };

  const getGamesByFolder = (gameIds: string[]) => {
    return gameIds
      .map((id) => library.find((game) => game.id === id))
      .filter(Boolean) as LibraryGame[];
  };

  const unorganizedGameIds = useMemo(() => {
    const allGameIds = library.map((game) => game.id);
    const unorganized = getUnorganizedGameIds(allGameIds);

    // Se a configuração de mostrar jogos duplicados estiver ativa,
    // incluir todos os jogos na biblioteca principal
    if (userPreferences?.showGamesInBothFoldersAndLibrary) {
      return allGameIds;
    }

    return unorganized;
  }, [
    library,
    getUnorganizedGameIds,
    userPreferences?.showGamesInBothFoldersAndLibrary,
  ]);

  const handleDragStart = (gameId: string) => {
    setDraggedGameId(gameId);
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDropOnFolder = (event: React.DragEvent, folderId: string) => {
    event.preventDefault();
    const gameId = event.dataTransfer.getData("text/plain");

    if (gameId && draggedGameId === gameId) {
      // Encontrar pasta atual do jogo
      const currentFolder = folders.find((folder) =>
        folder.gameIds.includes(gameId)
      );
      const currentFolderId = currentFolder?.id || null;

      // Mover jogo para nova pasta
      moveGameBetweenFolders(gameId, currentFolderId, folderId);
    }

    setDraggedGameId(null);
  };

  const handleDropOnLibrary = (event: React.DragEvent) => {
    event.preventDefault();
    const gameId = event.dataTransfer.getData("text/plain");

    if (gameId && draggedGameId === gameId) {
      // Encontrar pasta atual do jogo
      const currentFolder = folders.find((folder) =>
        folder.gameIds.includes(gameId)
      );
      const currentFolderId = currentFolder?.id || null;

      // Remover jogo de qualquer pasta (mover para biblioteca não organizada)
      if (currentFolderId) {
        moveGameBetweenFolders(gameId, currentFolderId, null);
      }
    }

    setDraggedGameId(null);
  };

  // Aplicar CSS custom property para a largura da sidebar no documento
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      `${sidebarWidth}px`
    );
  }, [sidebarWidth]);

  return (
    <aside
      ref={sidebarRef}
      className={cn("sidebar", {
        "sidebar--resizing": isResizing,
        "sidebar--darwin": window.electron?.platform === "darwin",
      })}
      style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        maxWidth: sidebarWidth,
      }}
    >
      <div className="sidebar__container">
        <SidebarProfile />

        <div className="sidebar__content">
          <section className="sidebar__section">
            <ul className="sidebar__menu">
              {routes.map(({ nameKey, path, render }) => (
                <li
                  key={nameKey}
                  className={cn("sidebar__menu-item", {
                    "sidebar__menu-item--active": location.pathname === path,
                  })}
                >
                  <button
                    type="button"
                    className="sidebar__menu-item-button"
                    onClick={() => handleSidebarItemClick(path)}
                  >
                    {render()}
                    <span>{t(nameKey)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {favoriteGames.length > 0 && (
            <section className="sidebar__section">
              <small className="sidebar__section-title">{t("favorites")}</small>

              <ul className="sidebar__menu">
                {favoriteGames.map((game) => (
                  <SidebarGameItem
                    key={game.id}
                    game={game}
                    handleSidebarGameClick={handleSidebarGameClick}
                    getGameTitle={getGameTitle}
                    onDragStart={handleDragStart}
                  />
                ))}
              </ul>
            </section>
          )}

          {folders.length > 0 && (
            <section className="sidebar__section">
              <div className="sidebar__section-header">
                <button
                  type="button"
                  className="sidebar__section-title-button"
                  onClick={toggleCustomFoldersExpansion}
                >
                  <small className="sidebar__section-title">
                    {t("custom_folders")}
                  </small>
                  <span style={{ marginLeft: "8px", fontSize: "10px" }}>
                    {isCustomFoldersExpanded ? "▼" : "▶"}
                  </span>
                </button>
                <button
                  type="button"
                  className="sidebar__play-button"
                  onClick={() => navigate("/folders-gallery")}
                  title="Visualização em Banners"
                >
                  <AppsIcon size={16} />
                </button>
              </div>

              {isCustomFoldersExpanded && (
                <ul className="sidebar__menu">
                  {folders.map((folder) => {
                    const folderGames = getGamesByFolder(folder.gameIds);
                    const isExpanded = expandedFolders.has(folder.id);

                    return (
                      <li key={folder.id}>
                        <button
                          type="button"
                          className="sidebar__menu-item-button sidebar__folder-button"
                          onClick={() => toggleFolderExpansion(folder.id)}
                          onDragOver={handleDragOver}
                          onDrop={(event) =>
                            handleDropOnFolder(event, folder.id)
                          }
                          style={{
                            fontWeight: "500",
                          }}
                        >
                          {folder.icon && folder.icon !== "folder" ? (
                            <FolderIcon iconId={folder.icon} size={16} />
                          ) : (
                            <FileDirectoryIcon size={16} />
                          )}
                          <span>
                            {folder.name}
                            {userPreferences?.showGameCountInFolders !==
                              false && ` (${folderGames.length})`}
                          </span>
                          <span
                            style={{ marginLeft: "auto", fontSize: "12px" }}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </span>
                        </button>

                        {isExpanded && (
                          <ul className="sidebar__submenu">
                            {folderGames
                              .filter(
                                (game) =>
                                  !showPlayableOnly || isGamePlayable(game)
                              )
                              .map((game) => (
                                <SidebarGameItem
                                  key={game.id}
                                  game={game}
                                  handleSidebarGameClick={
                                    handleSidebarGameClick
                                  }
                                  getGameTitle={getGameTitle}
                                  onDragStart={handleDragStart}
                                />
                              ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          <section
            className="sidebar__section"
            onDragOver={handleDragOver}
            onDrop={handleDropOnLibrary}
          >
            <div className="sidebar__section-header">
              <small className="sidebar__section-title">
                {t("my_library")}
              </small>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="sidebar__play-button"
                  onClick={() => setShowCreateGamesFolder(true)}
                  title={t("create_games_folder")}
                >
                  <FileDirectoryIcon size={16} />
                </button>
                <button
                  type="button"
                  className={cn("sidebar__play-button", {
                    "sidebar__play-button--active": showPlayableOnly,
                  })}
                  onClick={handlePlayButtonClick}
                >
                  <PlayIcon size={16} />
                </button>
              </div>
            </div>

            <TextField
              ref={filterRef}
              placeholder={t("filter")}
              onChange={handleFilter}
              theme="dark"
            />

            <ul className="sidebar__menu">
              {filteredLibrary
                .filter((game) => !game.favorite)
                .filter((game) => unorganizedGameIds.includes(game.id))
                .filter((game) => !showPlayableOnly || isGamePlayable(game))
                .map((game) => (
                  <SidebarGameItem
                    key={game.id}
                    game={game}
                    handleSidebarGameClick={handleSidebarGameClick}
                    getGameTitle={getGameTitle}
                    onDragStart={handleDragStart}
                  />
                ))}
            </ul>
          </section>
        </div>
      </div>

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

      <button
        type="button"
        className="sidebar__handle"
        onMouseDown={handleMouseDown}
      />

      <CreateGamesFolder
        visible={showCreateGamesFolder}
        onClose={() => setShowCreateGamesFolder(false)}
      />
    </aside>
  );
}
