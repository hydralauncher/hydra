import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import PlayLogo from "@renderer/assets/play-logo.svg?react";
import { LibraryGame } from "@types";
import cn from "classnames";
import { useLocation } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { XIcon } from "@primer/octicons-react";
import { ConfirmationModal, GameContextMenu, StreakBadge } from "..";
import { getDisplayStreak } from "@shared";
import { useAppSelector } from "@renderer/hooks";
import { useDrag, useDrop } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";

const SIDEBAR_GAME_DND_TYPE = "SIDEBAR_GAME";

interface DragItem {
  index: number;
  id: string;
  title: string;
  icon: string | null;
}

interface DownloadProgressInfo {
  raw: number;
  formatted: string;
}

interface SidebarGameItemProps {
  game: LibraryGame;
  handleSidebarGameClick: (event: React.MouseEvent, game: LibraryGame) => void;
  getGameTitle: (game: LibraryGame) => string;
  downloadProgress: DownloadProgressInfo | null;
  extractionProgress: DownloadProgressInfo | null;
  index?: number;
  onMoveGame?: (dragIndex: number, hoverIndex: number) => void;
  onDropGame?: () => void;
  draggable?: boolean;
}

export function SidebarGameItem({
  game,
  handleSidebarGameClick,
  getGameTitle,
  downloadProgress,
  extractionProgress,
  index,
  onMoveGame,
  onDropGame,
  draggable = false,
}: Readonly<SidebarGameItemProps>) {
  const { t } = useTranslation("sidebar");
  const location = useLocation();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const gameRunning = useAppSelector((state) => state.gameRunning.gameRunning);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    position: { x: number; y: number };
  }>({ visible: false, position: { x: 0, y: 0 } });
  const [showCloseGameModal, setShowCloseGameModal] = useState(false);

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    setContextMenu({
      visible: true,
      position: { x: event.clientX, y: event.clientY },
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu({ visible: false, position: { x: 0, y: 0 } });
  };

  const isCustomGame = game.shop === "custom";
  const sidebarIcon = isCustomGame
    ? game.libraryImageUrl || game.iconUrl
    : game.customIconUrl || game.iconUrl;

  const getFallbackIcon = () => {
    if (isCustomGame) {
      return <PlayLogo className="sidebar__game-icon" />;
    }
    return <SteamLogo className="sidebar__game-icon" />;
  };

  const [{ isDragging }, drag, preview] = useDrag({
    type: SIDEBAR_GAME_DND_TYPE,
    item: () => ({
      index: index!,
      id: game.id,
      title: game.title,
      icon: sidebarIcon ?? null,
    }),
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
    canDrag: () => draggable && index !== undefined,
  });

  useEffect(() => {
    if (draggable) {
      preview(getEmptyImage(), { captureDraggingState: true });
    }
  }, [draggable, preview]);

  const [, drop] = useDrop<DragItem>({
    accept: SIDEBAR_GAME_DND_TYPE,
    hover(item, monitor) {
      if (!onMoveGame || index === undefined) return;
      const dragIndex = item.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) return;

      const node = nodeRef.current;
      if (!node) return;

      const hoverBoundingRect = node.getBoundingClientRect();
      const hoverMiddleY =
        (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
      const clientOffset = monitor.getClientOffset();
      if (!clientOffset) return;
      const hoverClientY = clientOffset.y - hoverBoundingRect.top;

      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;

      onMoveGame(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
    drop() {
      onDropGame?.();
    },
  });

  const nodeRef = useCallback(
    (node: HTMLLIElement | null) => {
      if (draggable) {
        drag(drop(node));
      }
    },
    [drag, drop, draggable]
  ) as React.RefCallback<HTMLLIElement> &
    React.MutableRefObject<HTMLLIElement | null>;

  // Keep a stable ref for getBoundingClientRect in hover
  nodeRef.current = nodeRef.current ?? null;
  const originalNodeRef = nodeRef;
  const stableNodeRef = useCallback(
    (node: HTMLLIElement | null) => {
      (
        originalNodeRef as React.MutableRefObject<HTMLLIElement | null>
      ).current = node;
      originalNodeRef(node);
    },
    [originalNodeRef]
  );

  const isPlaying = gameRunning?.id === game.id;
  const isDownloading = downloadProgress !== null;
  const isExtracting = extractionProgress !== null;
  const isQueued =
    !isDownloading && !isExtracting && game.download?.queued === true;
  const isPaused =
    !isDownloading && !isExtracting && game.download?.status === "paused";
  const isNotInstalled =
    !game.executablePath &&
    !isDownloading &&
    !isExtracting &&
    !isQueued &&
    !isPaused;

  const renderStatusLabel = () => {
    if (isExtracting) {
      return (
        <span className="sidebar__menu-item-extraction-label">
          {extractionProgress.formatted}
        </span>
      );
    }

    if (isDownloading) {
      return (
        <span className="sidebar__menu-item-percentage">
          {downloadProgress.formatted}
        </span>
      );
    }

    if (isQueued) {
      return (
        <span className="sidebar__menu-item-queued-label">
          {t("queued_label")}
        </span>
      );
    }

    if (isPaused) {
      return (
        <span className="sidebar__menu-item-paused-label">
          {t("paused_label")}
        </span>
      );
    }

    if (isPlaying) {
      return (
        <span className="sidebar__menu-item-playing-label">
          {t("playing_label")}
          <button
            type="button"
            className="sidebar__menu-item-close-button"
            onClick={(e) => {
              e.stopPropagation();
              setShowCloseGameModal(true);
            }}
          >
            <XIcon size={12} />
          </button>
        </span>
      );
    }

    if (
      userPreferences?.enableNewDownloadOptionsBadges !== false &&
      (game.newDownloadOptionsCount ?? 0) > 0
    ) {
      return (
        <span className="sidebar__game-badge">
          +{game.newDownloadOptionsCount}
        </span>
      );
    }

    if (
      getDisplayStreak(
        {
          currentStreak: game.currentStreak ?? 0,
          longestStreak: game.longestStreak ?? 0,
          lastStreakDate: game.lastStreakDate ?? null,
        },
        new Date()
      ) >= 2
    ) {
      return (
        <StreakBadge
          currentStreak={game.currentStreak}
          longestStreak={game.longestStreak}
          lastStreakDate={game.lastStreakDate}
          variant="compact"
          animated={false}
        />
      );
    }

    return null;
  };

  return (
    <>
      <li
        ref={draggable ? stableNodeRef : undefined}
        className={cn("sidebar__menu-item", {
          "sidebar__menu-item--active":
            !isDragging &&
            location.pathname === `/game/${game.shop}/${game.objectId}`,
          "sidebar__menu-item--muted":
            !isDragging && game.download?.status === "removed",
          "sidebar__menu-item--downloading": !isDragging && isDownloading,
          "sidebar__menu-item--extracting": !isDragging && isExtracting,
          "sidebar__menu-item--queued": !isDragging && isQueued,
          "sidebar__menu-item--paused": !isDragging && isPaused,
          "sidebar__menu-item--playing": !isDragging && isPlaying,
          "sidebar__menu-item--not-installed": !isDragging && isNotInstalled,
          "sidebar__menu-item--skeleton": isDragging && draggable,
          "sidebar__menu-item--draggable": draggable && !isDragging,
        })}
      >
        {isDragging && draggable ? (
          <>
            <div className="sidebar__skeleton-content">
              <div className="sidebar__skeleton-icon" />
              <div className="sidebar__skeleton-text" />
            </div>
            <div className="sidebar__skeleton-shimmer" />
          </>
        ) : (
          <>
            {isExtracting && (
              <div
                className="sidebar__menu-item-progress sidebar__menu-item-progress--extraction"
                style={{ width: `${extractionProgress.raw * 100}%` }}
              />
            )}

            {isDownloading && (
              <div
                className="sidebar__menu-item-progress"
                style={{ width: `${downloadProgress.raw * 100}%` }}
              />
            )}

            <button
              type="button"
              className="sidebar__menu-item-button"
              onClick={(event) => handleSidebarGameClick(event, game)}
              onContextMenu={handleContextMenu}
            >
              {sidebarIcon ? (
                <img
                  className="sidebar__game-icon"
                  src={sidebarIcon}
                  alt={game.title}
                  loading="lazy"
                />
              ) : (
                getFallbackIcon()
              )}

              <span className="sidebar__menu-item-button-label">
                {getGameTitle(game)}
              </span>

              {renderStatusLabel()}
            </button>
          </>
        )}
      </li>

      {!isDragging && (
        <>
          <GameContextMenu
            game={game}
            visible={contextMenu.visible}
            position={contextMenu.position}
            onClose={handleCloseContextMenu}
          />

          <ConfirmationModal
            visible={showCloseGameModal}
            title={t("close_game_title")}
            descriptionText={t("close_game_description", {
              title: game.title,
            })}
            confirmButtonLabel={t("close_game_title")}
            cancelButtonLabel={t("custom_game_modal_cancel")}
            onClose={() => setShowCloseGameModal(false)}
            onConfirm={() => {
              window.electron.closeGame(game.shop, game.objectId);
              setShowCloseGameModal(false);
            }}
          />
        </>
      )}
    </>
  );
}
