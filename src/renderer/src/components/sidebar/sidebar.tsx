import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Tooltip } from "react-tooltip";

import type { LibraryGame } from "@types";

import { ConfirmationModal, TextField } from "@renderer/components";
import {
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { routes } from "./routes";

import "./sidebar.scss";

import { buildGameDetailsPath } from "@renderer/helpers";
import { useFormat } from "@renderer/hooks/use-format";

import {
  ChevronRightIcon,
  CommentDiscussionIcon,
  PlayIcon,
  PlusIcon,
  VideoIcon,
} from "@primer/octicons-react";
import deckyIcon from "@renderer/assets/icons/decky.png";
import cn from "classnames";
import { sortBy } from "lodash-es";
import { SidebarAddingCustomGameModal } from "./sidebar-adding-custom-game-modal";
import { SidebarGameItem } from "./sidebar-game-item";
import { SidebarProfile } from "./sidebar-profile";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_INITIAL_WIDTH = 250;
const SIDEBAR_MAX_WIDTH = 450;
const SIDEBAR_GAME_ITEM_HEIGHT = 42;

const initialSidebarWidth = window.localStorage.getItem("sidebarWidth");

const isGamePlayable = (game: LibraryGame) => Boolean(game.executablePath);

export function Sidebar() {
  const filterRef = useRef<HTMLInputElement>(null);

  const { t } = useTranslation("sidebar");
  const { formatNumber } = useFormat();
  const { library, updateLibrary } = useLibrary();
  const [deckyPluginInfo, setDeckyPluginInfo] = useState<{
    installed: boolean;
    version: string | null;
    outdated: boolean;
  }>({ installed: false, version: null, outdated: false });
  const [homebrewFolderExists, setHomebrewFolderExists] = useState(false);
  const [showDeckyConfirmModal, setShowDeckyConfirmModal] = useState(false);
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

  const { lastPacket, progress } = useDownload();

  const { showWarningToast, showSuccessToast, showErrorToast } = useToast();

  const [showPlayableOnly, setShowPlayableOnly] = useState(false);
  const [isGamesCollapsed, setIsGamesCollapsed] = useState(false);
  const [showAddGameModal, setShowAddGameModal] = useState(false);
  const [isGameListScrolled, setIsGameListScrolled] = useState(false);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  const gameListRef = useRef<HTMLDivElement>(null);

  const visibleGames = useMemo(
    () =>
      filteredLibrary.filter(
        (game) => !showPlayableOnly || isGamePlayable(game)
      ),
    [filteredLibrary, showPlayableOnly]
  );

  const virtualizer = useVirtualizer({
    count: visibleGames.length,
    getScrollElement: () => gameListRef.current,
    estimateSize: () => SIDEBAR_GAME_ITEM_HEIGHT,
    overscan: 5,
  });

  useEffect(() => {
    const el = gameListRef.current;
    if (!el) return;
    const measure = () => setScrollbarWidth(el.offsetWidth - el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

    if (
      game.download?.queued &&
      game.download.status !== "removed" &&
      game.download.status !== "complete" &&
      game.download.status !== "seeding"
    ) {
      return t("queued", { title: game.title });
    }

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
      {globalThis.window.electron.platform === "darwin" && (
        <button
          type="button"
          className="sidebar__big-picture-darwin"
          onClick={() => globalThis.window.electron.openBigPictureWindow()}
        >
          <VideoIcon size={14} />
          {t("big_picture")}
        </button>
      )}

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

              {window.electron.platform === "linux" && homebrewFolderExists && (
                <li className="sidebar__menu-item sidebar__menu-item--decky">
                  <button
                    type="button"
                    className="sidebar__menu-item-button"
                    onClick={handleInstallHydraDeckyPlugin}
                  >
                    <img
                      src={deckyIcon}
                      alt=""
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

          <section className="sidebar__section sidebar__section--games">
            <div className="sidebar__section-header">
              <button
                type="button"
                className="sidebar__section-toggle"
                onClick={() => setIsGamesCollapsed(!isGamesCollapsed)}
                aria-label={
                  isGamesCollapsed ? t("expand_games") : t("collapse_games")
                }
              >
                <ChevronRightIcon
                  size={14}
                  className={cn("sidebar__section-toggle-chevron", {
                    "sidebar__section-toggle-chevron--expanded":
                      !isGamesCollapsed,
                  })}
                />
                <small className="sidebar__section-title">{t("games")}</small>
                {library.length > 0 && (
                  <span className="sidebar__collection-count">
                    {formatNumber(library.length)}
                  </span>
                )}
              </button>
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

            {!isGamesCollapsed && (
              <>
                <TextField
                  ref={filterRef}
                  placeholder={t("filter")}
                  onChange={handleFilter}
                  theme="dark"
                />

                <div
                  className={`sidebar__game-list${isGameListScrolled ? " sidebar__game-list--scrolled" : ""}`}
                >
                  <div
                    ref={gameListRef}
                    className="sidebar__game-list-scroll"
                    onScroll={(e) =>
                      setIsGameListScrolled(
                        (e.currentTarget as HTMLElement).scrollTop > 0
                      )
                    }
                  >
                    <div
                      style={{
                        height: `${virtualizer.getTotalSize()}px`,
                        position: "relative",
                      }}
                    >
                      {virtualizer.getVirtualItems().map((virtualItem) => {
                        const game = visibleGames[virtualItem.index];
                        return (
                          <div
                            key={game.id}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              right: 16 - scrollbarWidth,
                              transform: `translateY(${virtualItem.start}px)`,
                            }}
                          >
                            <SidebarGameItem
                              game={game}
                              handleSidebarGameClick={handleSidebarGameClick}
                              getGameTitle={getGameTitle}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}
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
