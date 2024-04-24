import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import type { Game } from "@types";

import { AsyncImage, TextField } from "@renderer/components";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@renderer/components/context-menu/context-menu";
import { useDownload, useLibrary } from "@renderer/hooks";
import { SPACING_UNIT } from "@renderer/theme.css";

import { routes } from "./routes";

import {
  FileDirectoryIcon,
  FileDirectorySymlinkIcon,
  MarkGithubIcon,
  TrashIcon,
} from "@primer/octicons-react";
import DiscordLogo from "@renderer/assets/discord-icon.svg";
import XLogo from "@renderer/assets/x-icon.svg";
import { DeleteModal } from "./delete-modal";
import * as styles from "./sidebar.css";

const socials = [
  {
    url: "https://discord.gg/hydralauncher",
    icon: <DiscordLogo />,
  },
  {
    url: "https://twitter.com/hydralauncher",
    icon: <XLogo />,
  },
  {
    url: "https://github.com/hydralauncher/hydra",
    icon: <MarkGithubIcon size={16} />,
  },
];

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_INITIAL_WIDTH = 250;
const SIDEBAR_MAX_WIDTH = 450;

const initialSidebarWidth = window.localStorage.getItem("sidebarWidth");

export function Sidebar() {
  const { t } = useTranslation("sidebar");
  const { library, updateLibrary } = useLibrary();
  const navigate = useNavigate();

  const [filteredLibrary, setFilteredLibrary] = useState<Game[]>([]);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [currentGameId, setCurrentGameId] = useState(0);

  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(
    initialSidebarWidth ? Number(initialSidebarWidth) : SIDEBAR_INITIAL_WIDTH
  );

  const location = useLocation();

  const { game: gameDownloading, progress } = useDownload();

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

  const selectGameExecutable = async () => {
    return window.electron
      .showOpenDialog({
        properties: ["openFile"],
        filters: [
          {
            name: "Game executable",
            extensions: window.electron.platform === "win32" ? ["exe"] : [],
          },
        ],
      })
      .then(({ filePaths }) => {
        if (filePaths && filePaths.length > 0) {
          return filePaths[0];
        }
      });
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

  const openGameFolder = (gameId: number) =>
    window.electron.openGameFolder(gameId).then(() => {
      updateLibrary();
    });

  const updateExePath = async (gameId: number) => {
    const gameExecutablePath = await selectGameExecutable();
    window.electron
      .openGame(gameId, gameExecutablePath)
      .then(() => updateLibrary());
  };

  const handleOpenDeleteGameModal = async (gameId: number) => {
    setShowDeleteModal(true);
    setCurrentGameId(gameId);
  };

  useEffect(() => {
    updateLibrary();
  }, [gameDownloading?.id, updateLibrary]);

  const isDownloading = library.some((game) =>
    ["downloading", "checking_files", "downloading_metadata"].includes(
      game.status
    )
  );

  useEffect(() => {
    setFilteredLibrary(library);
  }, [library]);

  useEffect(() => {
    window.onmousemove = (event) => {
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
          {window.electron.platform === "darwin" && (
            <h2 style={{ marginBottom: SPACING_UNIT }}>Hydra</h2>
          )}

          <section className={styles.section({ hasBorder: false })}>
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

          <section className={styles.section({ hasBorder: false })}>
            <small className={styles.sectionTitle}>{t("my_library")}</small>

            <TextField
              placeholder={t("filter")}
              onChange={handleFilter}
              theme="dark"
            />

            <ul className={styles.menu}>
              {filteredLibrary.map((game) => {
                return (
                  <ContextMenu key={game.id}>
                    <ContextMenuTrigger>
                      <li
                        className={styles.menuItem({
                          active:
                            location.pathname ===
                            `/game/${game.shop}/${game.objectID}`,
                          muted: game.status === "cancelled",
                        })}
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
                          <AsyncImage
                            className={styles.gameIcon}
                            src={game.iconUrl}
                          />
                          <span className={styles.menuItemButtonLabel}>
                            {getGameTitle(game)}
                          </span>
                        </button>
                      </li>
                    </ContextMenuTrigger>

                    <ContextMenuContent>
                      <ContextMenuItem
                        onClick={() => openGameFolder(game.id)}
                        asChild
                      >
                        <button
                          className={styles.contextMenuItem}
                          disabled={
                            game.downloadPath === null ||
                            game.folderName === null
                          }
                        >
                          <FileDirectoryIcon
                            className={styles.contextMenuItemIcon}
                          />
                          <span>{t("open_archive_path")}</span>
                        </button>
                      </ContextMenuItem>

                      <ContextMenuItem
                        onClick={() => updateExePath(game.id)}
                        asChild
                      >
                        <button
                          className={styles.contextMenuItem}
                          disabled={
                            game.downloadPath === null ||
                            game.folderName === null
                          }
                        >
                          <FileDirectorySymlinkIcon
                            className={styles.contextMenuItemIcon}
                          />
                          <span>{t("change_exe_path")}</span>
                        </button>
                      </ContextMenuItem>

                      <ContextMenuItem
                        onClick={() => handleOpenDeleteGameModal(game.id)}
                        asChild
                      >
                        <button
                          className={styles.contextMenuItem}
                          disabled={
                            game.downloadPath === null ||
                            game.folderName === null
                          }
                        >
                          <TrashIcon className={styles.contextMenuItemIcon} />
                          <span>{t("delete_installation_files")}</span>
                        </button>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}

              <DeleteModal
                visible={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                gameId={currentGameId}
              />
            </ul>
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
