import "./card-presentation.scss";

import type { GameShop } from "@types";
import { platformToSystem, SYSTEM_TO_BINARY } from "@renderer/helpers";
import { EMULATOR_ICONS } from "@renderer/pages/settings/emulation/emulator-icons";
import { useEffect, useState } from "react";
import {
  formatPlayedTime,
  getGameAchievementProgress,
  resolveImageSource,
} from "../../../helpers";
import { useDominantColor } from "../../../hooks";

type LibraryGameCardVariant = "vertical" | "horizontal";

export interface LibraryGameCardPresentationSource {
  id?: string | number;
  objectId: string;
  shop: GameShop;
  title: string;
  platform?: string | null;
  customIconUrl?: string | null;
  customHeroImageUrl?: string | null;
  customLogoImageUrl?: string | null;
  iconUrl?: string | null;
  coverImageUrl?: string | null;
  libraryHeroImageUrl?: string | null;
  libraryImageUrl?: string | null;
  logoImageUrl?: string | null;
  playTimeInMilliseconds?: number | null;
  achievementCount?: number | null;
  unlockedAchievementCount?: number | null;
}

const PLATFORM_LABELS: Partial<
  Record<NonNullable<ReturnType<typeof platformToSystem>>, string>
> = {
  ps1: "PS",
  ps2: "PS2",
  ps3: "PS3",
};

function getResolvedImageSources(
  sources: Array<string | null | undefined>
): string[] {
  return sources
    .map((source) => resolveImageSource(source))
    .filter((source, index, array) => {
      return source !== "" && array.indexOf(source) === index;
    });
}

function getPresentationImageSources(
  game: LibraryGameCardPresentationSource,
  variant: LibraryGameCardVariant
) {
  if (variant === "horizontal") {
    const horizontalSources =
      game.shop === "launchbox"
        ? [
            game.customHeroImageUrl,
            game.libraryHeroImageUrl,
            game.libraryImageUrl,
            game.customIconUrl,
            game.iconUrl,
          ]
        : [
            game.customHeroImageUrl,
            game.libraryHeroImageUrl,
            game.coverImageUrl,
            game.libraryImageUrl,
            game.customIconUrl,
            game.iconUrl,
          ];

    return getResolvedImageSources(horizontalSources);
  }

  return getResolvedImageSources([
    game.customIconUrl,
    game.coverImageUrl,
    game.libraryImageUrl,
    game.iconUrl,
  ]);
}

export function useLibraryGameCardPresentation(
  game: LibraryGameCardPresentationSource,
  variant: LibraryGameCardVariant
) {
  const imageSources = getPresentationImageSources(game, variant);
  const [imageSourceIndex, setImageSourceIndex] = useState(0);
  const [imageExhausted, setImageExhausted] = useState(false);
  const imageSourcesSignature = imageSources.join("|");

  useEffect(() => {
    setImageSourceIndex(0);
    setImageExhausted(false);
  }, [game.id, game.objectId, game.shop, imageSourcesSignature]);

  const activeImageSource = imageExhausted
    ? null
    : (imageSources[imageSourceIndex] ?? null);
  const dominantColor = useDominantColor(activeImageSource);
  const achievementProgress = getGameAchievementProgress(game);
  const classicsSystem =
    game.shop === "launchbox" ? platformToSystem(game.platform) : null;
  const classicsPlatformLabel = classicsSystem
    ? (PLATFORM_LABELS[classicsSystem] ?? null)
    : null;
  const classicsEmulatorIcon = classicsSystem
    ? EMULATOR_ICONS[SYSTEM_TO_BINARY[classicsSystem]]
    : undefined;
  const logoImageUrl = resolveImageSource(
    game.customLogoImageUrl ?? game.logoImageUrl
  );

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
    classicsEmulatorIcon,
    classicsPlatformLabel,
    dominantColor,
    handleCoverImageError,
    logoImageUrl,
    playtimeLabel: formatPlayedTime(game.playTimeInMilliseconds, {
      zeroFallback: "Never played",
    }),
  };
}

interface ClassicsCoverBadgesProps {
  platformLabel: string;
  emulatorIcon?: string;
}

export function ClassicsCoverBadges({
  platformLabel,
  emulatorIcon,
}: Readonly<ClassicsCoverBadgesProps>) {
  return (
    <div className="library-classics-badges" aria-hidden="true">
      <span className="library-classics-platform-badge">{platformLabel}</span>
      {emulatorIcon ? (
        <span className="library-classics-emulator-badge">
          <img src={emulatorIcon} alt="" />
        </span>
      ) : null}
    </div>
  );
}

interface ClassicsVerticalCoverMediaProps {
  imageUrl: string;
  gameTitle: string;
  onImageError?: () => void;
}

export function ClassicsVerticalCoverMedia({
  imageUrl,
  gameTitle,
  onImageError,
}: Readonly<ClassicsVerticalCoverMediaProps>) {
  return (
    <div className="vertical-game-card__classics-cover" aria-hidden="true">
      <img
        src={imageUrl}
        alt=""
        className="vertical-game-card__classics-backdrop"
        draggable={false}
      />
      <img
        src={imageUrl}
        alt={gameTitle}
        className="vertical-game-card__classics-image"
        draggable={false}
        onError={onImageError}
      />
    </div>
  );
}
