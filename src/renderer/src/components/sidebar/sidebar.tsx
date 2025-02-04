import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

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

import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { SidebarProfile } from "./sidebar-profile";
import { sortBy } from "lodash-es";
import cn from "classnames";
import { CommentDiscussionIcon } from "@primer/octicons-react";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_INITIAL_WIDTH = 250;
const SIDEBAR_MAX_WIDTH = 450;

const initialSidebarWidth = window.localStorage.getItem("sidebarWidth");

export function Sidebar() {
  const filterRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    updateLibrary();
  }, [lastPacket?.gameId, updateLibrary]);

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

          <section className="sidebar__section">
            <small className="sidebar__section-title">{t("favorites")}</small>

            <ul className="sidebar__menu">
              {sortedLibrary
                .filter((game) => game.favorite)
                .map((game) => (
                  <li
                    key={game.id}
                    className={cn("sidebar__menu-item", {
                      "sidebar__menu-item--active":
                        location.pathname ===
                        `/game/${game.shop}/${game.objectId}`,
                      "sidebar__menu-item--muted":
                        game.download?.status === "removed",
                    })}
                  >
                    <button
                      type="button"
                      className="sidebar__menu-item-button"
                      onClick={(event) => handleSidebarGameClick(event, game)}
                    >
                      {game.iconUrl ? (
                        <img
                          className="sidebar__game-icon"
                          src={game.iconUrl}
                          alt={game.title}
                          loading="lazy"
                        />
                      ) : (
                        <SteamLogo className="sidebar__game-icon" />
                      )}

                      <span className="sidebar__menu-item-button-label">
                        {getGameTitle(game)}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>

          <section className="sidebar__section">
            <small className="sidebar__section-title">{t("my_library")}</small>

            <TextField
              ref={filterRef}
              placeholder={t("filter")}
              onChange={handleFilter}
              theme="dark"
            />

            <ul className="sidebar__menu">
              {filteredLibrary
                .filter((game) => !game.favorite)
                .map((game) => (
                  <li
                    key={game.id}
                    className={cn("sidebar__menu-item", {
                      "sidebar__menu-item--active":
                        location.pathname ===
                        `/game/${game.shop}/${game.objectId}`,
                      "sidebar__menu-item--muted":
                        game.download?.status === "removed",
                    })}
                  >
                    <button
                      type="button"
                      className="sidebar__menu-item-button"
                      onClick={(event) => handleSidebarGameClick(event, game)}
                    >
                      {game.iconUrl ? (
                        <img
                          className="sidebar__game-icon"
                          src={game.iconUrl}
                          alt={game.title}
                          loading="lazy"
                        />
                      ) : (
                        <SteamLogo className="sidebar__game-icon" />
                      )}

                      <span className="sidebar__menu-item-button-label">
                        {getGameTitle(game)}
                      </span>
                    </button>
                  </li>
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
    </aside>
  );
}
