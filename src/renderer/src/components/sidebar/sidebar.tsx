import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Tooltip } from "react-tooltip";

import type { LibraryGame } from "@types";

import { TextField } from "@renderer/components";
import {
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
  CommentDiscussionIcon,
  PlayIcon,
  PlusIcon,
} from "@primer/octicons-react";
import { SidebarGameItem } from "./sidebar-game-item";
import { SidebarAddingCustomGameModal } from "./sidebar-adding-custom-game-modal";
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

  const { showWarningToast } = useToast();

  const [showPlayableOnly, setShowPlayableOnly] = useState(false);
  const [showAddGameModal, setShowAddGameModal] = useState(false);

  const handlePlayButtonClick = () => {
    setShowPlayableOnly(!showPlayableOnly);
  };

  const handleAddGameButtonClick = () => {
    setShowAddGameModal(true);
  };

  const handleCloseAddGameModal = () => {
    setShowAddGameModal(false);
  };

  useEffect(() => {
    updateLibrary();
  }, [lastPacket?.gameId, updateLibrary]);

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
              ref={filterRef}
              placeholder={t("filter")}
              onChange={handleFilter}
              theme="dark"
            />

            <ul className="sidebar__menu">
              {filteredLibrary
                .filter((game) => !game.favorite)
                .filter((game) => !showPlayableOnly || isGamePlayable(game))
                .map((game) => (
                  <SidebarGameItem
                    key={game.id}
                    game={game}
                    handleSidebarGameClick={handleSidebarGameClick}
                    getGameTitle={getGameTitle}
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

      <SidebarAddingCustomGameModal
        visible={showAddGameModal}
        onClose={handleCloseAddGameModal}
      />

      <Tooltip id="add-custom-game-tooltip" />
      <Tooltip id="show-playable-only-tooltip" />
    </aside>
  );
}
