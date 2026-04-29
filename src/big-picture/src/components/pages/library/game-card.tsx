import type { LibraryGame } from "@types";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react";
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
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getLibraryFocusGridItemId,
  getLibraryFocusListItemId,
} from "./navigation";

export interface VerticalLibraryGameCardProps {
  game: LibraryGame;
  navigationOverrides?: FocusOverrides;
}

export interface HorizontalLibraryGameListCardProps {
  game: LibraryGame;
  navigationOverrides?: FocusOverrides;
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

function LibraryGameCardAction() {
  return (
    <div
      className="library-game-card__action-button button button--secondary button--icon"
      aria-hidden="true"
    >
      <DotsThreeVerticalIcon size={24} />
    </div>
  );
}

export function VerticalLibraryGameCard({
  game,
  navigationOverrides,
}: Readonly<VerticalLibraryGameCardProps>) {
  const navigate = useNavigate();
  const {
    activeImageSource,
    achievementProgress,
    dominantColor,
    handleCoverImageError,
    playtimeLabel,
  } = useLibraryGameCardPresentation(game, "vertical");
  const gameDetailsPath = getBigPictureGameDetailsPath(game);

  return (
    <FocusItem
      id={getLibraryFocusGridItemId(game.id)}
      actions={{
        primary: () => navigate(gameDetailsPath),
        secondary: "off",
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
        onClick={() => navigate(gameDetailsPath)}
        action={<LibraryGameCardAction />}
        onCoverImageError={handleCoverImageError}
      />
    </FocusItem>
  );
}

export function HorizontalLibraryGameListCard({
  game,
  navigationOverrides,
}: Readonly<HorizontalLibraryGameListCardProps>) {
  const navigate = useNavigate();
  const {
    activeImageSource,
    achievementProgress,
    dominantColor,
    handleCoverImageError,
    playtimeLabel,
  } = useLibraryGameCardPresentation(game, "horizontal");
  const gameDetailsPath = getBigPictureGameDetailsPath(game);

  return (
    <FocusItem
      id={getLibraryFocusListItemId(game.id)}
      actions={{
        primary: () => navigate(gameDetailsPath),
        secondary: "off",
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
        onClick={() => navigate(gameDetailsPath)}
        action={<LibraryGameCardAction />}
        onCoverImageError={handleCoverImageError}
      />
    </FocusItem>
  );
}
