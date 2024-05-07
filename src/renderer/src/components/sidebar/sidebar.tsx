import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import type { Game } from "@types";

import { TextField } from "@renderer/components";
import { useDownload, useLibrary } from "@renderer/hooks";

import { routes } from "./routes";

import {
  FileDirectoryIcon,
  FileDirectorySymlinkIcon,
  MarkGithubIcon,
  TrashIcon,
} from "@primer/octicons-react";
import DiscordLogo from "@renderer/assets/discord-icon.svg?react";
import XLogo from "@renderer/assets/x-icon.svg?react";

import * as styles from "./sidebar.css";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_INITIAL_WIDTH = 250;
const SIDEBAR_MAX_WIDTH = 450;

const initialSidebarWidth = window.localStorage.getItem("sidebarWidth");

export function Sidebar() {
  const { t } = useTranslation("sidebar");
  const { library, updateLibrary } = useLibrary();
  const navigate = useNavigate();

  const [filteredLibrary, setFilteredLibrary] = useState<Game[]>([]);

  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(
    initialSidebarWidth ? Number(initialSidebarWidth) : SIDEBAR_INITIAL_WIDTH
  );

  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [axilCoordinates, setAxilCoordinates] = useState({
    x: 0,
    y: 0,
  });

  const socials = [
    {
      url: "https://discord.gg/hydralauncher",
      icon: <DiscordLogo />,
      label: t("discord"),
    },
    {
      url: "https://twitter.com/hydralauncher",
      icon: <XLogo />,
      label: t("x"),
    },
    {
      url: "https://github.com/hydralauncher/hydra",
      icon: <MarkGithubIcon size={16} />,
      label: t("github"),
    },
  ];

  const location = useLocation();

  const { game: gameDownloading, progress } = useDownload();

  const isDownloading = library.some((game) =>
    ["downloading", "checking_files", "downloading_metadata"].includes(
      game.status
    )
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

  const getGameTitle = (game: Game) => {
    if (game.status === "paused") return t("paused", { title: game.title });

    if (gameDownloading?.id === game.id) {
      const isVerifying = ["downloading_metadata", "checking_files"].includes(
        gameDownloading?.status
      );

      if (isVerifying)
        return t(gameDownloading.status, {
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

  useEffect(() => {
    updateLibrary();
  }, [gameDownloading?.id, updateLibrary]);

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

  useEffect(() => {
    // closes context menu if click out of focus
    const handleClick = () => setIsContextMenuOpen(false);
    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("click", handleClick);
    };
  }, []);

  return (
    <>
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
            <small className={styles.sectionTitle}>{t("my_library")}</small>

            <TextField
              placeholder={t("filter")}
              onChange={handleFilter}
              theme="dark"
            />

            {filteredLibrary.map((game) => (
              <>
                <ul className={styles.menu}>
                  <li
                    key={game.id}
                    className={styles.menuItem({
                      active:
                        location.pathname ===
                        `/game/${game.shop}/${game.objectID}`,
                      muted: game.status === "cancelled",
                    })}
                    onContextMenu={(e) => {
                      e.preventDefault();

                      setIsContextMenuOpen(true);
                      setAxilCoordinates({
                        x: e.pageX,
                        y: e.pageY,
                      });
                    }}
                  >
                    <button
                      type="button"
                      className={styles.menuItemButton}
                      onClick={() =>
                        handleSidebarItemClick(
                          `/game/${game.shop}/${game.objectID}`
                        )
                      }
                    >
                      <img
                        className={styles.gameIcon}
                        src={game.iconUrl}
                        alt={game.title}
                      />
                      <span className={styles.menuItemButtonLabel}>
                        {getGameTitle(game)}
                      </span>
                    </button>
                  </li>
                </ul>

                {isContextMenuOpen && (
                  <div
                    className={styles.contextMenu}
                    style={{
                      top: axilCoordinates.y - 15,
                      left: axilCoordinates.x,
                    }}
                  >
                    <menu className={styles.contextMenuList}>
                      <button
                        // onClick={() => openGameFolder(game.id)}
                        className={styles.contextMenuListItem}
                        // disabled={
                        //   game.downloadPath === null ||
                        //   game.folderName === null
                        // }
                        onClick={() => {
                          setIsContextMenuOpen(false);
                          console.log("clicou");
                        }}
                      >
                        <FileDirectoryIcon
                          className={styles.contextMenuItemIcon}
                        />
                        <span>Abrir local do arquivo</span>
                      </button>

                      <button
                        className={styles.contextMenuListItem}
                        // onClick={() => updateExePath(game.id)}
                        onClick={() => {
                          setIsContextMenuOpen(false);
                          console.log("clicou");
                        }}
                      >
                        <FileDirectorySymlinkIcon
                          className={styles.contextMenuItemIcon}
                        />
                        <span>Alterar caminho do executável</span>
                      </button>

                      <button
                        className={styles.contextMenuListItem}
                        onClick={() => {
                          setIsContextMenuOpen(false);
                          console.log("clicou");
                        }}
                      >
                        <TrashIcon className={styles.contextMenuItemIcon} />
                        <span>Remover arquivos de instalação</span>
                      </button>
                    </menu>
                  </div>
                )}
              </>
            ))}
          </section>
        </div>

        <button
          type="button"
          className={styles.handle}
          onMouseDown={handleMouseDown}
        />

        <footer className={styles.sidebarFooter}>
          <div className={styles.footerText}>{t("follow_us")}</div>

          <span className={styles.footerSocialsContainer}>
            {socials.map((item) => {
              return (
                <button
                  key={item.url}
                  className={styles.footerSocialsItem}
                  onClick={() => window.electron.openExternal(item.url)}
                  title={item.label}
                  aria-label={item.label}
                >
                  {item.icon}
                </button>
              );
            })}
          </span>
        </footer>
      </aside>
    </>
  );
}
