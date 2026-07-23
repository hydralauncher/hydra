import "./card-presentation.scss";

import type { ArtworkAssetType, EmulatorSystem, GameShop } from "@types";
import { resolveClassicsBadge } from "@renderer/helpers";
import {
  EMULATOR_ICONS,
  RETROARCH_EMULATOR_ICON,
} from "@renderer/pages/settings/emulation/emulator-icons";
import {
  isAnimatedCoverCandidate,
  useCoverPoster,
} from "@renderer/hooks/use-cover-poster";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getGameAchievementProgress,
  resolveImageSource,
} from "../../../helpers";
import { useDominantColor, useFormat } from "../../../hooks";

export function useFocusAnimatedCover(
  coverUrl: string | null | undefined,
  isFocused: boolean
): string {
  const isAnimated = isAnimatedCoverCandidate(coverUrl);
  const poster = useCoverPoster(coverUrl, isAnimated);

  if (isAnimated && poster && !isFocused) {
    return resolveImageSource(poster);
  }

  return coverUrl ?? "";
}

type LibraryGameCardVariant = "vertical" | "horizontal";

export interface LibraryGameCardPresentationSource {
  id?: string | number;
  objectId: string;
  shop: GameShop;
  title: string;
  platform?: string | null;
  customIconUrl?: string | null;
  customCoverImageUrl?: string | null;
  customHeroImageUrl?: string | null;
  customLogoImageUrl?: string | null;
  selectedArtworkTypes?: ArtworkAssetType[];
  iconUrl?: string | null;
  coverImageUrl?: string | null;
  libraryHeroImageUrl?: string | null;
  libraryImageUrl?: string | null;
  logoImageUrl?: string | null;
  playTimeInMilliseconds?: number | null;
  achievementCount?: number | null;
  unlockedAchievementCount?: number | null;
}

const PLATFORM_LABELS: Partial<Record<EmulatorSystem, string>> = {
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
    game.customCoverImageUrl,
    game.coverImageUrl,
    game.libraryImageUrl,
    game.iconUrl,
  ]);
}

function isChosenCoverSource(
  game: LibraryGameCardPresentationSource,
  source: string
) {
  const chosenCovers = [
    game.customCoverImageUrl,
    game.selectedArtworkTypes?.includes("grid") ? game.coverImageUrl : null,
  ];

  return chosenCovers.some(
    (candidate) => !!candidate && resolveImageSource(candidate) === source
  );
}

export function useLibraryGameCardPresentation(
  game: LibraryGameCardPresentationSource,
  variant: LibraryGameCardVariant
) {
  const { t } = useTranslation(["game_details", "big_picture"]);
  const { formatPlayTime } = useFormat();
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
  const isChosenCoverActive = Boolean(
    activeImageSource && isChosenCoverSource(game, activeImageSource)
  );
  const dominantColor = useDominantColor(activeImageSource);
  const achievementProgress = getGameAchievementProgress(game);
  const { label: classicsPlatformLabel, icon: classicsEmulatorIcon } =
    resolveClassicsBadge(game.shop, game.platform, PLATFORM_LABELS, {
      emulatorIcons: EMULATOR_ICONS,
      retroarchIcon: RETROARCH_EMULATOR_ICON,
    });
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
    isChosenCoverActive,
    achievementProgress,
    classicsEmulatorIcon,
    classicsPlatformLabel,
    dominantColor,
    handleCoverImageError,
    logoImageUrl,
    playtimeLabel: game.playTimeInMilliseconds
      ? t("play_time", {
          amount: formatPlayTime(game.playTimeInMilliseconds / 1000),
        })
      : t("never_played", { ns: "big_picture" }),
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
