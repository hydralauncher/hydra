import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import type { LibraryGame } from "@types";

import { ConfirmationModal, TextField } from "@renderer/components";
import { useDownload, useLibrary, useToast } from "@renderer/hooks";
import { routes } from "./routes";

import "./sidebar.scss";

import {
  buildGameDetailsPath,
  filterLibraryGamesByCategory,
  sortLibraryGames,
} from "@renderer/helpers";
import type { LibraryCategory } from "@renderer/pages/library/category-filter";
import type { SortOption } from "@renderer/pages/library/filter-options";

import { PlayIcon, VideoIcon } from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";
import deckyIcon from "@renderer/assets/icons/decky.png";
import cn from "classnames";
import { SidebarFilterMenu } from "./sidebar-filter-menu";
import { SidebarGameItem } from "./sidebar-game-item";
import { SidebarProfile } from "./sidebar-profile";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_INITIAL_WIDTH = 250;
const SIDEBAR_MAX_WIDTH = 450;
const SIDEBAR_GAME_ITEM_HEIGHT = 42;

const SIDEBAR_CATEGORIES = new Set<LibraryCategory>(["all", "pc", "classics"]);
const SIDEBAR_SORT_OPTIONS = new Set<SortOption>([
  "title_asc",
  "recently_played",
  "most_played",
]);

const isGamePlayable = (game: LibraryGame) =>
  Boolean(game.executablePath) ||
  (game.shop === "launchbox" && (game.discs?.length ?? 0) > 0);

const initialSidebarWidth = window.localStorage.getItem("sidebarWidth");

export function Sidebar() {
  const { t } = useTranslation(["sidebar", "library"]);
  const { library, updateLibrary } = useLibrary();
  const [deckyPluginInfo, setDeckyPluginInfo] = useState<{
    installed: boolean;
    version: string | null;
    outdated: boolean;
  }>({ installed: false, version: null, outdated: false });
  const [homebrewFolderExists, setHomebrewFolderExists] = useState(false);
  const [showDeckyConfirmModal, setShowDeckyConfirmModal] = useState(false);
  const navigate = useNavigate();

  const filterRef = useRef<HTMLInputElement>(null);

  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(
    initialSidebarWidth ? Number(initialSidebarWidth) : SIDEBAR_INITIAL_WIDTH
  );

  const location = useLocation();

  const [sidebarCategory, setSidebarCategory] = useState<LibraryCategory>(
    () => {
      const saved = localStorage.getItem("sidebar-category");
      if (SIDEBAR_CATEGORIES.has(saved as LibraryCategory)) {
        return saved as LibraryCategory;
      }
      return "all";
    }
  );

  const [sidebarSortBy, setSidebarSortBy] = useState<SortOption>(() => {
    const saved = localStorage.getItem("sidebar-sort-by");
    if (SIDEBAR_SORT_OPTIONS.has(saved as SortOption)) {
      return saved as SortOption;
    }
    return "title_asc";
  });

  const [showFavoritesFirst, setShowFavoritesFirst] = useState<boolean>(() => {
    return localStorage.getItem("sidebar-favorites-first") !== "false";
  });

  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [showPlayableOnly, setShowPlayableOnly] = useState(false);

  const uniquePlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const game of library) {
      if (game.shop === "launchbox" && game.platform) {
        set.add(game.platform);
      }
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [library]);

  const sortedLibrary = useMemo(() => {
    let games = filterLibraryGamesByCategory(library, sidebarCategory);

    if (sidebarCategory === "classics" && selectedPlatform) {
      games = games.filter((game) => game.platform === selectedPlatform);
    }

    games = sortLibraryGames(games, sidebarSortBy);

    if (showFavoritesFirst) {
      games = [
        ...games.filter((game) => game.favorite),
        ...games.filter((game) => !game.favorite),
      ];
    }

    return games;
  }, [
    library,
    sidebarCategory,
    sidebarSortBy,
    selectedPlatform,
    showFavoritesFirst,
  ]);

  const { lastPacket, progress } = useDownload();

  const { showSuccessToast, showErrorToast } = useToast();

  const [isGameListScrolled, setIsGameListScrolled] = useState(false);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  const gameListRef = useRef<HTMLDivElement>(null);

  const [filteredLibrary, setFilteredLibrary] = useState<LibraryGame[]>([]);

  useEffect(() => {
    setFilteredLibrary(sortedLibrary);

    if (filterRef.current) {
      filterRef.current.value = "";
    }
  }, [sortedLibrary]);

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

  const handleFilter: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    setFilteredLibrary(
      sortedLibrary.filter((game) =>
        (game.title ?? "")
          .toLowerCase()
          .includes(event.target.value.toLocaleLowerCase())
      )
    );
  };

  const handleSidebarCategoryChange = useCallback((next: LibraryCategory) => {
    setSidebarCategory(next);
    localStorage.setItem("sidebar-category", next);
    if (next !== "classics") {
      setSelectedPlatform(null);
    }
  }, []);

  const handleSidebarSortChange = useCallback((next: SortOption) => {
    setSidebarSortBy(next);
    localStorage.setItem("sidebar-sort-by", next);
  }, []);

  const handleToggleFavoritesFirst = useCallback((next: boolean) => {
    setShowFavoritesFirst(next);
    localStorage.setItem("sidebar-favorites-first", String(next));
  }, []);

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
    const handlePinToggled = () => {
      void updateLibrary();
    };

    window.addEventListener("hydra:game-pin-toggled", handlePinToggled);
    return () => {
      window.removeEventListener("hydra:game-pin-toggled", handlePinToggled);
    };
  }, [updateLibrary]);

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

  const handleSidebarGameClick = (game: LibraryGame) => {
    const path = buildGameDetailsPath({
      ...game,
      objectId: game.objectId,
    });
    if (path !== location.pathname) {
      navigate(path);
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
            <div className="sidebar__search-row">
              <TextField
                ref={filterRef}
                placeholder={t("filter")}
                onChange={handleFilter}
                theme="dark"
              />

              <button
                type="button"
                className={cn("sidebar__play-button", {
                  "sidebar__play-button--active": showPlayableOnly,
                })}
                onClick={() => setShowPlayableOnly((prev) => !prev)}
                data-tooltip-id="sidebar-show-playable-only-tooltip"
                data-tooltip-content={t("show_playable_only_tooltip")}
                data-tooltip-place="top"
              >
                <PlayIcon size={16} />
              </button>

              <Tooltip id="sidebar-show-playable-only-tooltip" place="top" />

              <SidebarFilterMenu
                category={sidebarCategory}
                onCategoryChange={handleSidebarCategoryChange}
                sortBy={sidebarSortBy}
                onSortChange={handleSidebarSortChange}
                showFavoritesFirst={showFavoritesFirst}
                onToggleFavoritesFirst={handleToggleFavoritesFirst}
                platforms={uniquePlatforms}
                selectedPlatform={selectedPlatform}
                onPlatformChange={setSelectedPlatform}
              />
            </div>

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
          </section>
        </div>
      </div>

      <button
        type="button"
        className="sidebar__handle"
        onMouseDown={handleMouseDown}
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
    </aside>
  );
}
