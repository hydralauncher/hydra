import { Fragment, useEffect, useRef, useState } from "react";
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
import { GameStatus, GameStatusHelper } from "@shared";
import { DeleteModal } from "./delete-modal";
import * as styles from "./sidebar.css";

import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import TelegramIcon from "@renderer/assets/telegram-icon.svg?react";
import XLogo from "@renderer/assets/x-icon.svg?react";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_INITIAL_WIDTH = 250;
const SIDEBAR_MAX_WIDTH = 450;

const initialSidebarWidth = window.localStorage.getItem("sidebarWidth");

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation("sidebar");
  const { library, updateLibrary } = useLibrary();
  const { game: gameDownloading, progress } = useDownload();

  const [filteredLibrary, setFilteredLibrary] = useState<Game[]>([]);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(
    initialSidebarWidth ? Number(initialSidebarWidth) : SIDEBAR_INITIAL_WIDTH
  );
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [axisCoordinates, setAxisCoordinates] = useState({
    x: 0,
    y: 0,
  });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [currentGame, setCurrentGame] = useState<Game>();

  const sidebarRef = useRef<HTMLElement>(null);
  const cursorPos = useRef({ x: 0 });
  const sidebarInitialWidth = useRef(0);

  const isDownloading = library.some((game) =>
    GameStatusHelper.isDownloading(game.status)
  );

  const socials = [
    {
      url: "https://t.me/hydralauncher",
      icon: <TelegramIcon />,
      label: t("telegram"),
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

  const selectGameExecutable = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: t("game_executable"),
          extensions: window.electron.platform === "win32" ? ["exe"] : [],
        },
      ],
    });

    if (filePaths && filePaths.length > 0) {
      return filePaths[0];
    }

    return null;
  };

  const updateExePath = async () => {
    try {
      const gameExecutablePath = await selectGameExecutable();
      if (gameExecutablePath) {
        await window.electron.changeExecutablePath(
          currentGame?.id ?? 0,
          gameExecutablePath
        );

        await window.electron.openGame(
          currentGame?.id ?? 0,
          gameExecutablePath
        );

        updateLibrary();
      }
    } catch (error) {
      console.error("Error updating game executable path: ", error);
    }
  };

  const openGameFolder = () =>
    window.electron.openGameFolder(currentGame?.id ?? 0).then(() => {
      updateLibrary();
    });

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

  const handleOpenDeleteGameModal = async () => {
    setShowDeleteModal(true);
    setIsContextMenuOpen(false);
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

            <ul className={styles.menu}>
              {filteredLibrary.map((game) => {
                return (
                  <Fragment key={game.id}>
                    <li
                      key={game.id}
                      className={styles.menuItem({
                        active:
                          location.pathname ===
                          `/game/${game.shop}/${game.objectID}`,
                        muted: game.status === "cancelled",
                      })}
                      onContextMenu={(e) => {
                        setIsContextMenuOpen(true);
                        setCurrentGame(game);
                        setAxisCoordinates({
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

                    {isContextMenuOpen && (
                      <div
                        className={styles.contextMenu}
                        style={{
                          top: axisCoordinates.y - 15,
                          left: axisCoordinates.x,
                        }}
                      >
                        <menu className={styles.contextMenuList}>
                          <button
                            onClick={() => {
                              openGameFolder();
                              setIsContextMenuOpen(false);
                            }}
                            className={styles.contextMenuListItem}
                            disabled={
                              currentGame?.downloadPath === null ||
                              currentGame?.folderName === null ||
                              currentGame?.status === "cancelled"
                            }
                          >
                            <FileDirectoryIcon
                              className={styles.contextMenuItemIcon}
                            />
                            <span>{t("open_archive_path")}</span>
                          </button>

                          <button
                            className={styles.contextMenuListItem}
                            onClick={async () => {
                              // TO-DO: add toast or desktop notification
                              await updateExePath();
                              setIsContextMenuOpen(false);
                            }}
                            disabled={
                              currentGame?.downloadPath === null ||
                              currentGame?.folderName === null ||
                              currentGame?.status === "cancelled"
                            }
                          >
                            <FileDirectorySymlinkIcon
                              className={styles.contextMenuItemIcon}
                            />
                            <span>{t("change_exe_path")}</span>
                          </button>

                          <button
                            className={styles.contextMenuListItem}
                            onClick={() => {
                              // TO-DO: add toast or desktop notification
                              handleOpenDeleteGameModal();
                            }}
                            disabled={
                              currentGame?.downloadPath === null ||
                              currentGame?.folderName === null ||
                              currentGame?.status === "cancelled"
                            }
                          >
                            <TrashIcon className={styles.contextMenuItemIcon} />
                            <span>{t("delete_installation_files")}</span>
                          </button>
                        </menu>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </ul>

            <DeleteModal
              visible={showDeleteModal}
              onClose={() => setShowDeleteModal(false)}
              gameId={currentGame?.id ?? 0}
            />
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

      <button
        type="button"
        className={styles.handle}
        onMouseDown={handleMouseDown}
      />
    </>
  );
}
