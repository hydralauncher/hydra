import type { LibraryGame } from "@types";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import {
  FocusItem,
  HorizontalLibraryGameCard,
  VerticalGameCard,
} from "../../common";
import { getBigPictureGameDetailsPath } from "../../../helpers";
import type { FocusOverrides } from "../../../services";
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  getLibraryFocusGridItemId,
  getLibraryFocusListItemId,
} from "./navigation";
import {
  ClassicsCoverBadges,
  ClassicsVerticalCoverMedia,
  useLibraryGameCardPresentation,
} from "./card-presentation";

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
    classicsEmulatorIcon,
    classicsPlatformLabel,
    dominantColor,
    handleCoverImageError,
    playtimeLabel,
  } = useLibraryGameCardPresentation(game, "vertical");
  const focusId = getLibraryFocusGridItemId(game.id);
  const gameDetailsPath = getBigPictureGameDetailsPath(game);
  const coverMedia =
    game.shop === "launchbox" && activeImageSource ? (
      <ClassicsVerticalCoverMedia
        imageUrl={activeImageSource}
        gameTitle={game.title}
        onImageError={handleCoverImageError}
      />
    ) : null;
  const coverOverlay =
    classicsPlatformLabel != null ? (
      <ClassicsCoverBadges
        platformLabel={classicsPlatformLabel}
        emulatorIcon={classicsEmulatorIcon}
      />
    ) : null;

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
        press: {
          y: onOpenContextMenu
            ? () => {
                const buttonRect =
                  menuButtonRef.current?.getBoundingClientRect() ?? null;

                if (buttonRect) {
                  openContextMenuFromRect(buttonRect);
                }
              }
            : undefined,
        },
      }}
      navigationOverrides={navigationOverrides}
    >
      <VerticalGameCard
        className={
          game.shop === "launchbox"
            ? "library-focus-grid__card library-focus-grid__card--classics"
            : "library-focus-grid__card"
        }
        coverImageUrl={activeImageSource}
        coverMedia={coverMedia}
        coverOverlay={coverOverlay}
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
    classicsEmulatorIcon,
    classicsPlatformLabel,
    dominantColor,
    handleCoverImageError,
    logoImageUrl,
    playtimeLabel,
  } = useLibraryGameCardPresentation(game, "horizontal");
  const focusId = getLibraryFocusListItemId(game.id);
  const gameDetailsPath = getBigPictureGameDetailsPath(game);
  const coverOverlay =
    classicsPlatformLabel != null ? (
      <ClassicsCoverBadges
        platformLabel={classicsPlatformLabel}
        emulatorIcon={classicsEmulatorIcon}
      />
    ) : null;

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
        press: {
          y: onOpenContextMenu
            ? () => {
                const buttonRect =
                  menuButtonRef.current?.getBoundingClientRect() ?? null;

                if (buttonRect) {
                  openContextMenuFromRect(buttonRect);
                }
              }
            : undefined,
        },
      }}
      navigationOverrides={navigationOverrides}
    >
      <HorizontalLibraryGameCard
        className={
          game.shop === "launchbox"
            ? "library-focus-list__card library-focus-list__card--classics"
            : "library-focus-list__card"
        }
        coverImageUrl={activeImageSource}
        logoImageUrl={logoImageUrl || null}
        coverOverlay={coverOverlay}
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
