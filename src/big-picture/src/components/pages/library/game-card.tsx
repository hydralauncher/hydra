import type { LibraryGame } from "@types";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import {
  FocusItem,
  HorizontalLibraryGameCard,
  VerticalGameCard,
} from "../../common";
import {
  formatPlayedTime,
  getBigPictureGameDetailsPath,
  getGameAchievementProgress,
  getGameImageSources,
  getGameLandscapeImageSources,
} from "../../../helpers";
import type { FocusOverrides } from "../../../services";
import { useDominantColor } from "../../../hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getLibraryFocusGridItemId,
  getLibraryFocusListItemId,
} from "./navigation";

export interface VerticalLibraryGameCardProps {
  game: LibraryGame;
  navigationOverrides?: FocusOverrides;
  contextMenuOpen?: boolean;
  onOpenContextMenu?: (
    game: LibraryGame,
    position: { x: number; y: number },
    restoreFocusId: string
  ) => void;
}

export interface HorizontalLibraryGameListCardProps {
  game: LibraryGame;
  navigationOverrides?: FocusOverrides;
  contextMenuOpen?: boolean;
  onOpenContextMenu?: (
    game: LibraryGame,
    position: { x: number; y: number },
    restoreFocusId: string
  ) => void;
}

function useLibraryGameCardPresentation(
  game: LibraryGame,
  variant: "vertical" | "horizontal"
) {
  const imageSources = useMemo(() => {
    return variant === "horizontal"
      ? getGameLandscapeImageSources(game)
      : getGameImageSources(game);
  }, [game, variant]);
  const [imageSourceIndex, setImageSourceIndex] = useState(0);
  const [imageExhausted, setImageExhausted] = useState(false);

  useEffect(() => {
    setImageSourceIndex(0);
    setImageExhausted(false);
  }, [game.id, imageSources]);

  const activeImageSource = imageExhausted
    ? null
    : (imageSources[imageSourceIndex] ?? null);

  const dominantColor = useDominantColor(activeImageSource);
  const achievementProgress = getGameAchievementProgress(game);

  const handleCoverImageError = () => {
    if (imageSourceIndex < imageSources.length - 1) {
      setImageSourceIndex((currentIndex) => currentIndex + 1);
      return;
    }

    setImageExhausted(true);
  };

  return {
    activeImageSource,
    achievementProgress,
    dominantColor,
    handleCoverImageError,
    playtimeLabel: formatPlayedTime(game.playTimeInMilliseconds, {
      zeroFallback: "Never played",
    }),
  };
}

interface LibraryGameCardActionProps {
  gameTitle: string;
  buttonRef: RefObject<HTMLButtonElement>;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

function LibraryGameCardAction({
  gameTitle,
  buttonRef,
  onClick,
}: Readonly<LibraryGameCardActionProps>) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="library-game-card__action-button button button--secondary button--icon"
      aria-label={`Open context menu for ${gameTitle}`}
      tabIndex={-1}
      onClick={onClick}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
    >
      <DotsThreeVerticalIcon size={24} />
    </button>
  );
}

export function VerticalLibraryGameCard({
  game,
  navigationOverrides,
  contextMenuOpen = false,
  onOpenContextMenu,
}: Readonly<VerticalLibraryGameCardProps>) {
  const navigate = useNavigate();
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const {
    activeImageSource,
    achievementProgress,
    dominantColor,
    handleCoverImageError,
    playtimeLabel,
  } = useLibraryGameCardPresentation(game, "vertical");
  const focusId = getLibraryFocusGridItemId(game.id);
  const gameDetailsPath = getBigPictureGameDetailsPath(game);

  const openContextMenuFromRect = (
    rect: DOMRect,
    restoreFocusId: string = focusId
  ) => {
    onOpenContextMenu?.(
      game,
      {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
      restoreFocusId
    );
  };

  return (
    <FocusItem
      id={focusId}
      actions={{
        primary: () => navigate(gameDetailsPath),
        secondary: onOpenContextMenu
          ? () => {
              const buttonRect =
                menuButtonRef.current?.getBoundingClientRect() ?? null;

              if (buttonRect) {
                openContextMenuFromRect(buttonRect);
              }
            }
          : "off",
      }}
      navigationOverrides={navigationOverrides}
    >
      <VerticalGameCard
        className="library-focus-grid__card"
        coverImageUrl={activeImageSource}
        gameTitle={game.title}
        subtitle={playtimeLabel}
        progressLabel={achievementProgress.label}
        progressValue={achievementProgress.value}
        progressColor={dominantColor ?? undefined}
        forceHovered={contextMenuOpen}
        onClick={() => navigate(gameDetailsPath)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenContextMenu?.(
            game,
            {
              x: event.clientX,
              y: event.clientY,
            },
            focusId
          );
        }}
        action={
          <LibraryGameCardAction
            gameTitle={game.title}
            buttonRef={menuButtonRef}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openContextMenuFromRect(
                event.currentTarget.getBoundingClientRect()
              );
            }}
          />
        }
        onCoverImageError={handleCoverImageError}
      />
    </FocusItem>
  );
}

export function HorizontalLibraryGameListCard({
  game,
  navigationOverrides,
  contextMenuOpen = false,
  onOpenContextMenu,
}: Readonly<HorizontalLibraryGameListCardProps>) {
  const navigate = useNavigate();
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const {
    activeImageSource,
    achievementProgress,
    dominantColor,
    handleCoverImageError,
    playtimeLabel,
  } = useLibraryGameCardPresentation(game, "horizontal");
  const focusId = getLibraryFocusListItemId(game.id);
  const gameDetailsPath = getBigPictureGameDetailsPath(game);

  const openContextMenuFromRect = (
    rect: DOMRect,
    restoreFocusId: string = focusId
  ) => {
    onOpenContextMenu?.(
      game,
      {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
      restoreFocusId
    );
  };

  return (
    <FocusItem
      id={focusId}
      actions={{
        primary: () => navigate(gameDetailsPath),
        secondary: onOpenContextMenu
          ? () => {
              const buttonRect =
                menuButtonRef.current?.getBoundingClientRect() ?? null;

              if (buttonRect) {
                openContextMenuFromRect(buttonRect);
              }
            }
          : "off",
      }}
      navigationOverrides={navigationOverrides}
    >
      <HorizontalLibraryGameCard
        className="library-focus-list__card"
        coverImageUrl={activeImageSource}
        gameTitle={game.title}
        subtitle={playtimeLabel}
        progressLabel={achievementProgress.label}
        progressValue={achievementProgress.value}
        progressColor={dominantColor ?? undefined}
        forceHovered={contextMenuOpen}
        onClick={() => navigate(gameDetailsPath)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenContextMenu?.(
            game,
            {
              x: event.clientX,
              y: event.clientY,
            },
            focusId
          );
        }}
        action={
          <LibraryGameCardAction
            gameTitle={game.title}
            buttonRef={menuButtonRef}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openContextMenuFromRect(
                event.currentTarget.getBoundingClientRect()
              );
            }}
          />
        }
        onCoverImageError={handleCoverImageError}
      />
    </FocusItem>
  );
}
