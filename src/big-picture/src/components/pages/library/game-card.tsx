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
  ClassicsVerticalCoverMedia,
  getLibraryCoverOverlay,
  useFocusAnimatedCover,
  useLibraryGameCardPresentation,
} from "./card-presentation";
import { useNavigationIsFocused } from "../../../stores";

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

type OnOpenContextMenu = (
  game: LibraryGame,
  position: { x: number; y: number },
  restoreFocusId: string
) => void;

// Shared between the vertical (grid) and horizontal (list) library cards --
// both wrap the same game in a FocusItem and need the same "open the
// context menu, either from the action button's rect or from a right
// click" behavior, just rendered through different card components.
function useGameCardContextMenu(
  game: LibraryGame,
  focusId: string,
  onOpenContextMenu?: OnOpenContextMenu
) {
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

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

  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
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
  };

  const pressAction = onOpenContextMenu
    ? () => {
        const buttonRect =
          menuButtonRef.current?.getBoundingClientRect() ?? null;

        if (buttonRect) {
          openContextMenuFromRect(buttonRect);
        }
      }
    : undefined;

  const action = (
    <LibraryGameCardAction
      gameTitle={game.title}
      buttonRef={menuButtonRef}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenuFromRect(event.currentTarget.getBoundingClientRect());
      }}
    />
  );

  return { handleContextMenu, pressAction, action };
}

export function VerticalLibraryGameCard({
  game,
  navigationOverrides,
  contextMenuOpen = false,
  onOpenContextMenu,
}: Readonly<VerticalLibraryGameCardProps>) {
  const navigate = useNavigate();
  const {
    activeImageSource,
    isChosenCoverActive,
    achievementProgress,
    classicsEmulatorIcon,
    classicsPlatformLabel,
    dominantColor,
    handleCoverImageError,
    playtimeLabel,
  } = useLibraryGameCardPresentation(game, "vertical");
  const focusId = getLibraryFocusGridItemId(game.id);
  const isFocused = useNavigationIsFocused(focusId);
  const displayCover = useFocusAnimatedCover(activeImageSource, isFocused);
  const gameDetailsPath = getBigPictureGameDetailsPath(game);
  const coverMedia =
    game.shop === "launchbox" && activeImageSource && !isChosenCoverActive ? (
      <ClassicsVerticalCoverMedia
        imageUrl={displayCover}
        gameTitle={game.title}
        onImageError={handleCoverImageError}
      />
    ) : null;
  const coverOverlay = getLibraryCoverOverlay(
    game,
    classicsPlatformLabel,
    classicsEmulatorIcon
  );
  const { handleContextMenu, pressAction, action } = useGameCardContextMenu(
    game,
    focusId,
    onOpenContextMenu
  );

  return (
    <FocusItem
      id={focusId}
      actions={{
        primary: () => navigate(gameDetailsPath),
        press: { y: pressAction },
      }}
      navigationOverrides={navigationOverrides}
    >
      <VerticalGameCard
        className={
          game.shop === "launchbox"
            ? "library-focus-grid__card library-focus-grid__card--classics"
            : "library-focus-grid__card"
        }
        coverImageUrl={displayCover}
        coverMedia={coverMedia}
        coverOverlay={coverOverlay}
        gameTitle={game.title}
        subtitle={playtimeLabel}
        progressLabel={achievementProgress.label}
        progressValue={achievementProgress.value}
        progressColor={dominantColor ?? undefined}
        forceHovered={contextMenuOpen}
        onClick={() => navigate(gameDetailsPath)}
        onContextMenu={handleContextMenu}
        action={action}
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
  const coverOverlay = getLibraryCoverOverlay(
    game,
    classicsPlatformLabel,
    classicsEmulatorIcon
  );
  const { handleContextMenu, pressAction, action } = useGameCardContextMenu(
    game,
    focusId,
    onOpenContextMenu
  );

  return (
    <FocusItem
      id={focusId}
      actions={{
        primary: () => navigate(gameDetailsPath),
        press: { y: pressAction },
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
        onContextMenu={handleContextMenu}
        action={action}
        onCoverImageError={handleCoverImageError}
      />
    </FocusItem>
  );
}
