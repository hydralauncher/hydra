import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Tooltip } from "react-tooltip";

import type { LibraryGame } from "@types";

import { TextField, ConfirmationModal } from "@renderer/components";
import {
  useAppSelector,
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";

import { routes } from "./routes";

import "./sidebar.scss";

import { buildGameDetailsPath } from "@renderer/helpers";

import { SidebarProfile } from "./sidebar-profile";
import { sortBy } from "lodash-es";
import cn from "classnames";
import {
  ClockIcon,
  CommentDiscussionIcon,
  PlayIcon,
  PlusIcon,
  TrophyIcon,
  XIcon,
} from "@primer/octicons-react";
import { SidebarGameItem } from "./sidebar-game-item";
import { SidebarDragLayer } from "./sidebar-drag-layer";
import { SidebarAddingCustomGameModal } from "./sidebar-adding-custom-game-modal";

import { setFriendRequestCount } from "@renderer/features/user-details-slice";
import { useDispatch } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import deckyIcon from "@renderer/assets/icons/decky.png";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_INITIAL_WIDTH = 250;
const SIDEBAR_MAX_WIDTH = 450;

const initialSidebarWidth = window.localStorage.getItem("sidebarWidth");

const isGamePlayable = (game: LibraryGame) => Boolean(game.executablePath);

export function Sidebar() {
  const dispatch = useDispatch();

  const { t } = useTranslation("sidebar");
  const { library, updateLibrary } = useLibrary();
  const [deckyPluginInfo, setDeckyPluginInfo] = useState<{
    installed: boolean;
    version: string | null;
    outdated: boolean;
  }>({ installed: false, version: null, outdated: false });
  const [homebrewFolderExists, setHomebrewFolderExists] = useState(false);
  const [showDeckyConfirmModal, setShowDeckyConfirmModal] = useState(false);
  const navigate = useNavigate();

  const [filterText, setFilterText] = useState("");

  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(
    initialSidebarWidth ? Number(initialSidebarWidth) : SIDEBAR_INITIAL_WIDTH
  );

  const location = useLocation();

  const gameRunning = useAppSelector((state) => state.gameRunning.gameRunning);

  const [gameOrder, setGameOrder] = useState<string[]>(() => {
    try {
      const stored = window.localStorage.getItem("sidebarGameOrder");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const sortedLibrary = useMemo(() => {
    const alphabetical = sortBy(library, (game) => game.title);
    const libraryIds = new Set(library.map((g) => g.id));

    const prunedOrder = gameOrder.filter((id) => libraryIds.has(id));
    const orderedIds = new Set(prunedOrder);
    const newGames = alphabetical.filter((g) => !orderedIds.has(g.id));
    const finalOrder = [...prunedOrder, ...newGames.map((g) => g.id)];

    const gameMap = new Map(library.map((g) => [g.id, g]));
    return finalOrder.map((id) => gameMap.get(id)!).filter(Boolean);
  }, [library, gameOrder]);

  const handleDropGame = useCallback(() => {
    setGameOrder((current) => {
      window.localStorage.setItem("sidebarGameOrder", JSON.stringify(current));
      return current;
    });
  }, []);

  const runningGame = useMemo(() => {
    if (!gameRunning) return null;
    return library.find((g) => g.id === gameRunning.id) ?? null;
  }, [gameRunning, library]);

  const formatSessionTime = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const { hasActiveSubscription } = useUserDetails();

  const { lastPacket, progress } = useDownload();
  const extraction = useAppSelector((state) => state.download.extraction);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { showWarningToast, showSuccessToast, showErrorToast } = useToast();

  const [showPlayableOnly, setShowPlayableOnly] = useState(false);
  const [showAddGameModal, setShowAddGameModal] = useState(false);

  const visibleLibraryGames = useMemo(() => {
    return sortedLibrary.filter(
      (g) =>
        !g.favorite &&
        (!showPlayableOnly || isGamePlayable(g)) &&
        (!filterText ||
          g.title.toLowerCase().includes(filterText.toLowerCase()))
    );
  }, [sortedLibrary, showPlayableOnly, filterText]);

  const handleMoveGame = useCallback(
    (dragIndex: number, hoverIndex: number) => {
      const draggedId = visibleLibraryGames[dragIndex]?.id;
      const hoveredId = visibleLibraryGames[hoverIndex]?.id;
      if (!draggedId || !hoveredId || draggedId === hoveredId) return;

      setGameOrder((prev) => {
        const alphabetical = sortBy(library, (g) => g.title);
        let currentIds: string[];

        if (prev.length > 0) {
          const libraryIds = new Set(library.map((g) => g.id));
          const pruned = prev.filter((id) => libraryIds.has(id));
          const orderedSet = new Set(pruned);
          const newIds = alphabetical
            .filter((g) => !orderedSet.has(g.id))
            .map((g) => g.id);
          currentIds = [...pruned, ...newIds];
        } else {
          currentIds = alphabetical.map((g) => g.id);
        }

        const fromIdx = currentIds.indexOf(draggedId);
        const toIdx = currentIds.indexOf(hoveredId);
        if (fromIdx === -1 || toIdx === -1) return prev;

        const [removed] = currentIds.splice(fromIdx, 1);
        currentIds.splice(toIdx, 0, removed);
        return currentIds;
      });
    },
    [visibleLibraryGames, library]
  );

  const handlePlayButtonClick = () => {
    setShowPlayableOnly(!showPlayableOnly);
  };

  const handleAddGameButtonClick = () => {
    setShowAddGameModal(true);
  };

  const handleCloseAddGameModal = () => {
    setShowAddGameModal(false);
  };

  const loadDeckyPluginInfo = async () => {
    if (window.electron.platform !== "linux") return;

    try {
      const [info, folderExists] = await Promise.all([
        window.electron.getHydraDeckyPluginInfo(),
        window.electron.checkHomebrewFolderExists(),
      ]);

      setDeckyPluginInfo({
        installed: info.installed,
        version: info.version,
        outdated: info.outdated,
      });
      setHomebrewFolderExists(folderExists);
    } catch (error) {
      console.error("Failed to load Decky plugin info:", error);
    }
  };

  const handleInstallHydraDeckyPlugin = () => {
    if (deckyPluginInfo.installed && !deckyPluginInfo.outdated) {
      return;
    }
    setShowDeckyConfirmModal(true);
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
    setFilterText(event.target.value);
  };

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
      return game.title;
    }

    if (game.download?.queued) return game.title;

    if (game.download?.status === "paused") return game.title;

    return game.title;
  };

  const getGameDownloadProgress = (game: LibraryGame) => {
    if (lastPacket?.gameId === game.id) {
      return {
        raw: lastPacket.progress,
        formatted: progress,
      };
    }
    return null;
  };

  const getGameExtractionProgress = (game: LibraryGame) => {
    if (extraction?.visibleId === game.id) {
      return {
        raw: extraction.progress,
        formatted: `${Math.round(extraction.progress * 100)}%`,
      };
    }
    return null;
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

  const favoriteGames = useMemo(() => {
    return sortedLibrary.filter((game) => game.favorite);
  }, [sortedLibrary]);

  return (
    <aside
      ref={sidebarRef}
      className={cn("sidebar", {
        "sidebar--resizing": isResizing,
        "sidebar--darwin": window.electron.platform === "darwin",
      })}
      style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        maxWidth: sidebarWidth,
      }}
    >
      <SidebarDragLayer />

      <div className="sidebar__container">
        <SidebarProfile />

        <div className="sidebar__content">
          <section className="sidebar__section">
            <ul className="sidebar__menu">
              {routes
                .filter(
                  (route) =>
                    route.nameKey !== "roms" ||
                    userPreferences?.showROMsInSidebar
                )
                .map(({ nameKey, path, render }) => (
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
              {window.electron.platform === "linux" && homebrewFolderExists && (
                <li className="sidebar__menu-item sidebar__menu-item--decky">
                  <button
                    type="button"
                    className="sidebar__menu-item-button"
                    onClick={handleInstallHydraDeckyPlugin}
                  >
                    <img
                      src={deckyIcon}
                      alt="Decky"
                      style={{ width: 16, height: 16 }}
                    />
                    <span>
                      {deckyPluginInfo.installed && !deckyPluginInfo.outdated
                        ? t("decky_plugin_installed_version", {
                            version: deckyPluginInfo.version,
                          })
                        : deckyPluginInfo.installed && deckyPluginInfo.outdated
                          ? t("update_decky_plugin")
                          : t("install_decky_plugin")}
                    </span>
                  </button>
                </li>
              )}
            </ul>
          </section>

          <AnimatePresence>
            {gameRunning && (
              <motion.section
                key="now-playing"
                role="button"
                tabIndex={0}
                className="sidebar__now-playing-section"
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{
                  duration: 0.3,
                  ease: [0.4, 0, 0.2, 1],
                  opacity: { duration: 0.2 },
                }}
                onClick={() => {
                  const path = buildGameDetailsPath({
                    shop: gameRunning.shop,
                    objectId: gameRunning.objectId,
                    title: gameRunning.title,
                  });
                  if (path !== location.pathname) {
                    navigate(path);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    const path = buildGameDetailsPath({
                      shop: gameRunning.shop,
                      objectId: gameRunning.objectId,
                      title: gameRunning.title,
                    });
                    if (path !== location.pathname) {
                      navigate(path);
                    }
                  }
                }}
              >
                {(runningGame?.customHeroImageUrl ||
                  runningGame?.libraryHeroImageUrl) && (
                  <div className="sidebar__now-playing-cover">
                    <img
                      src={
                        (runningGame.customHeroImageUrl ||
                          runningGame.libraryHeroImageUrl)!
                      }
                      alt=""
                      className="sidebar__now-playing-cover-img"
                      loading="lazy"
                    />
                  </div>
                )}

                <div className="sidebar__now-playing-content">
                  {runningGame?.coverImageUrl && (
                    <img
                      src={runningGame.coverImageUrl}
                      alt=""
                      className="sidebar__now-playing-game-cover"
                      loading="lazy"
                    />
                  )}

                  <div className="sidebar__now-playing-body">
                    <div className="sidebar__now-playing-header">
                      <small className="sidebar__now-playing-label">
                        <span className="sidebar__now-playing-dot" />
                        {t("now_playing")}
                      </small>
                      <button
                        type="button"
                        className="sidebar__now-playing-close"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.electron.closeGame(
                            gameRunning.shop,
                            gameRunning.objectId
                          );
                        }}
                        title={t("close_game_title")}
                      >
                        <XIcon size={12} />
                      </button>
                    </div>

                    <span className="sidebar__now-playing-title">
                      {gameRunning.title}
                    </span>

                    <div className="sidebar__now-playing-stats">
                      <span className="sidebar__now-playing-stat">
                        <ClockIcon size={11} />
                        {formatSessionTime(gameRunning.sessionDurationInMillis)}
                      </span>
                      {runningGame?.achievementCount != null &&
                        runningGame.achievementCount > 0 && (
                          <span className="sidebar__now-playing-stat">
                            <TrophyIcon size={11} />
                            {runningGame.unlockedAchievementCount ?? 0}/
                            {runningGame.achievementCount}
                          </span>
                        )}
                    </div>
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

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
                    downloadProgress={getGameDownloadProgress(game)}
                    extractionProgress={getGameExtractionProgress(game)}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className="sidebar__section">
            <div className="sidebar__section-header">
              <small className="sidebar__section-title">
                {t("my_library")}
              </small>
              <div
                style={{ display: "flex", gap: "8px", alignItems: "center" }}
              >
                <button
                  type="button"
                  className="sidebar__add-button"
                  onClick={handleAddGameButtonClick}
                  data-tooltip-id="add-custom-game-tooltip"
                  data-tooltip-content={t("add_custom_game_tooltip")}
                  data-tooltip-place="top"
                >
                  <PlusIcon size={16} />
                </button>
                <button
                  type="button"
                  className={cn("sidebar__play-button", {
                    "sidebar__play-button--active": showPlayableOnly,
                  })}
                  onClick={handlePlayButtonClick}
                  data-tooltip-id="show-playable-only-tooltip"
                  data-tooltip-content={t("show_playable_only_tooltip")}
                  data-tooltip-place="top"
                >
                  <PlayIcon size={16} />
                </button>
              </div>
            </div>

            <TextField
              placeholder={t("filter")}
              value={filterText}
              onChange={handleFilter}
              theme="dark"
            />

            <ul className="sidebar__menu">
              {visibleLibraryGames.map((game, idx) => (
                <SidebarGameItem
                  key={game.id}
                  game={game}
                  handleSidebarGameClick={handleSidebarGameClick}
                  getGameTitle={getGameTitle}
                  downloadProgress={getGameDownloadProgress(game)}
                  extractionProgress={getGameExtractionProgress(game)}
                  index={idx}
                  onMoveGame={handleMoveGame}
                  onDropGame={handleDropGame}
                  draggable
                />
              ))}
            </ul>
          </section>
        </div>
      </div>

      <div className="sidebar__bottom-buttons">
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
      <Tooltip id="show-playable-only-tooltip" />
    </aside>
  );
}
