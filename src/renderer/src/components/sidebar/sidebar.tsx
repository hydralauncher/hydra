import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import type { LibraryGame } from "@types";

import { TextField } from "@renderer/components";
import { useDownload, useLibrary, useToast } from "@renderer/hooks";

import { routes } from "./routes";

import * as styles from "./sidebar.css";
import { buildGameDetailsPath } from "@renderer/helpers";

import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { SortDescIcon } from "@primer/octicons-react";
import { DropDownMenu } from "../drop-down-menu/drop-down-menu";
import { vars } from "@renderer/theme.css";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_INITIAL_WIDTH = 250;
const SIDEBAR_MAX_WIDTH = 450;

const initialSidebarWidth = window.localStorage.getItem("sidebarWidth");

enum LibrarySortingType {
  Alphabetically = "a-z",
  MostPlayed = "most_played",
  Downloaded = "downloaded",
}

export function Sidebar() {
  const { t } = useTranslation("sidebar");
  const { library, updateLibrary } = useLibrary();
  const navigate = useNavigate();

  const [filteredLibrary, setFilteredLibrary] = useState<LibraryGame[]>([]);
  const [sortingType, setSortingType] = useState<LibrarySortingType>(
    LibrarySortingType.Alphabetically
  );
  const sortLibraryOptions = useMemo(
    () => [
      {
        label: t("sorting_options.alphabetically"),
        value: LibrarySortingType.Alphabetically,
      },
      {
        label: t("sorting_options.most_played"),
        value: LibrarySortingType.MostPlayed,
      },
      {
        label: t("sorting_options.downloaded"),
        value: LibrarySortingType.Downloaded,
      },
    ],
    [t]
  );

  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(
    initialSidebarWidth ? Number(initialSidebarWidth) : SIDEBAR_INITIAL_WIDTH
  );

  const location = useLocation();

  const { lastPacket, progress } = useDownload();

  const { showWarningToast } = useToast();

  useEffect(() => {
    updateLibrary();
  }, [lastPacket?.game.id, updateLibrary]);

  const isDownloading = library.some(
    (game) => game.status === "active" && game.progress !== 1
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

  const getGameTitle = (game: LibraryGame) => {
    if (lastPacket?.game.id === game.id) {
      return t("downloading", {
        title: game.title,
        percentage: progress,
      });
    }

    if (game.downloadQueue !== null) {
      return t("queued", { title: game.title });
    }

    if (game.status === "paused") return t("paused", { title: game.title });

    return game.title;
  };

  const handleSidebarItemClick = (path: string) => {
    if (path !== location.pathname) {
      navigate(path);
    }
  };

  const sortLibrary = useCallback(
    (a: LibraryGame, b: LibraryGame) => {
      if (sortingType === LibrarySortingType.Alphabetically) {
        return b.title.localeCompare(a.title, "en");
      }

      if (sortingType === LibrarySortingType.MostPlayed) {
        return (
          (b.lastTimePlayed ?? new Date()).getTime() -
          (a.lastTimePlayed ?? new Date()).getTime()
        );
      }

      if (sortingType === LibrarySortingType.Downloaded) {
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      }

      return 0;
    },
    [sortingType]
  );

  const sortedLibrary = useMemo(
    () => [...filteredLibrary].sort(sortLibrary),
    [filteredLibrary, sortLibrary]
  );

  const handleSidebarGameClick = (
    event: React.MouseEvent,
    game: LibraryGame
  ) => {
    const path = buildGameDetailsPath(game);
    if (path !== location.pathname) {
      navigate(path);
    }

    if (event.detail == 2) {
      if (game.executablePath) {
        window.electron.openGame(game.id, game.executablePath);
      } else {
        showWarningToast(t("game_has_no_executable"));
      }
    }
  };

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
              trigger={<SortDescIcon fill={vars.color.body} />}
              align="end"
              options={sortLibraryOptions}
              onSelect={(value) => {
                setSortingType(value as LibrarySortingType);
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
                  muted: game.status === "removed",
                })}
              >
                <button
                  type="button"
                  className={styles.menuItemButton}
                  onClick={(event) => handleSidebarGameClick(event, game)}
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
