import type { LibraryGame } from "@types";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react";
import { FocusItem, VerticalGameCard } from "../../common";
import {
  formatPlayedTime,
  getGameAchievementProgress,
  getGameImageSources,
} from "../../../helpers";
import type { FocusOverrides } from "../../../services";
import { useDominantColor } from "../../../hooks";
import { useEffect, useMemo, useState } from "react";
import { getLibraryFocusGridItemId } from "./navigation";

export interface VerticalLibraryGameCardProps {
  game: LibraryGame;
  navigationOverrides?: FocusOverrides;
}

export function VerticalLibraryGameCard({
  game,
  navigationOverrides,
}: Readonly<VerticalLibraryGameCardProps>) {
  const imageSources = useMemo(() => getGameImageSources(game), [game]);
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

  return (
    <FocusItem
      id={getLibraryFocusGridItemId(game.id)}
      actions={{ primary: "off", secondary: "off" }}
      navigationOverrides={navigationOverrides}
    >
      <VerticalGameCard
        className="library-focus-grid__card"
        coverImageUrl={activeImageSource}
        gameTitle={game.title}
        subtitle={formatPlayedTime(game.playTimeInMilliseconds, {
          zeroFallback: "Never played",
        })}
        progressLabel={achievementProgress.label}
        progressValue={achievementProgress.value}
        progressColor={dominantColor ?? undefined}
        action={
          <div
            className="vertical-library-game-card__action-button button button--secondary button--icon"
            aria-hidden="true"
          >
            <DotsThreeVerticalIcon size={24} />
          </div>
        }
        onCoverImageError={handleCoverImageError}
      />
    </FocusItem>
  );
}
