import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import type { Game } from "@types";

import { TextField } from "@renderer/components";
import { useDownload, useLibrary } from "@renderer/hooks";

import { routes } from "./routes";

import * as styles from "./sidebar.css";
import { GameStatus, GameStatusHelper } from "@shared";
import { buildGameDetailsPath } from "@renderer/helpers";

import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import SortIcon from "@renderer/assets/sort-icon.svg?react";
import { DropDownMenu } from "../drop-down-menu/drop-down-menu";
import { vars } from "@renderer/theme.css";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_INITIAL_WIDTH = 250;
const SIDEBAR_MAX_WIDTH = 450;

const initialSidebarWidth = window.localStorage.getItem("sidebarWidth");

export function Sidebar() {
  const { t } = useTranslation("sidebar");
  const { library, updateLibrary } = useLibrary();
  const navigate = useNavigate();

  const [filteredLibrary, setFilteredLibrary] = useState<Game[]>([]);
  const [sortingType, setSortingType] = useState("a-z");
  const sortLibraryOptions = useMemo(
    () => [
      {
        label: t("sorting_options.alphabetically"),
        value: "a-z",
      },
      {
        label: t("sorting_options.most_played"),
        value: "most_played",
      },
      {
        label: t("sorting_options.downloaded"),
        value: "downloaded",
      },
    ],
    [t]
  );

  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(
    initialSidebarWidth ? Number(initialSidebarWidth) : SIDEBAR_INITIAL_WIDTH
  );

  const location = useLocation();

  const { game: gameDownloading, progress } = useDownload();

  useEffect(() => {
    updateLibrary();
  }, [gameDownloading?.id, updateLibrary]);

  const isDownloading = library.some((game) =>
    GameStatusHelper.isDownloading(game.status)
  );

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
      library.filter((game) =>
        game.title
          .toLowerCase()
          .includes(event.target.value.toLocaleLowerCase())
      )
    );
  };

  useEffect(() => {
    setFilteredLibrary(library);
  }, [library]);

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

  const getGameTitle = (game: Game) => {
    if (game.status === GameStatus.Paused)
      return t("paused", { title: game.title });

    if (gameDownloading?.id === game.id) {
      const isVerifying = GameStatusHelper.isVerifying(gameDownloading.status);

      if (isVerifying)
        return t(gameDownloading.status!, {
          title: game.title,
          percentage: progress,
        });

      return t("downloading", {
        title: game.title,
        percentage: progress,
      });
    }

    return game.title;
  };

  const handleSidebarItemClick = (path: string) => {
    if (path !== location.pathname) {
      navigate(path);
    }
  };

  const sortLibrary = useCallback(
    (a: Game, b: Game) => {
      if (sortingType === "a-z") {
        return a.title.localeCompare(b.title, "en");
      }

      if (sortingType === "most_played") {
        return b.playTimeInMilliseconds - a.playTimeInMilliseconds;
      }

      if (sortingType === "downloaded") {
        return a.status === GameStatus.Cancelled ? 1 : -1;
      }

      return 0;
    },
    [sortingType]
  );

  const sortedLibrary = useMemo(
    () => [...filteredLibrary].sort(sortLibrary),
    [filteredLibrary, sortLibrary]
  );

  return (
    <aside
      ref={sidebarRef}
      className={styles.sidebar({ resizing: isResizing })}
      style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        maxWidth: sidebarWidth,
      }}
    >
      <div
        className={styles.content({
          macos: window.electron.platform === "darwin",
        })}
      >
        {window.electron.platform === "darwin" && <h2>Hydra</h2>}

        <section className={styles.section}>
          <ul className={styles.menu}>
            {routes.map(({ nameKey, path, render }) => (
              <li
                key={nameKey}
                className={styles.menuItem({
                  active: location.pathname === path,
                })}
              >
                <button
                  type="button"
                  className={styles.menuItemButton}
                  onClick={() => handleSidebarItemClick(path)}
                >
                  {render(isDownloading)}
                  <span>{t(nameKey)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <small className={styles.sectionTitle}>{t("my_library")}</small>
            <DropDownMenu
              trigger={<SortIcon fill={vars.color.bodyText} />}
              align="end"
              options={sortLibraryOptions}
              onSelect={(value) => {
                setSortingType(value);
              }}
            />
          </div>

          <TextField
            placeholder={t("filter")}
            onChange={handleFilter}
            theme="dark"
          />
          <ul className={styles.menu}>
            {sortedLibrary.map((game) => (
              <li
                key={game.id}
                className={styles.menuItem({
                  active:
                    location.pathname === `/game/${game.shop}/${game.objectID}`,
                  muted: game.status === GameStatus.Cancelled,
                })}
              >
                <button
                  type="button"
                  className={styles.menuItemButton}
                  onClick={() =>
                    handleSidebarItemClick(buildGameDetailsPath(game))
                  }
                >
                  {game.iconUrl ? (
                    <img
                      className={styles.gameIcon}
                      src={game.iconUrl}
                      alt={game.title}
                    />
                  ) : (
                    <SteamLogo className={styles.gameIcon} />
                  )}

                  <span className={styles.menuItemButtonLabel}>
                    {getGameTitle(game)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <button
        type="button"
        className={styles.handle}
        onMouseDown={handleMouseDown}
      />
    </aside>
  );
}
