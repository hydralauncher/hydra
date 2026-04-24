import type { LibraryGame } from "@types";
import {
  ClockIcon,
  GearIcon,
  HeartIcon,
  PlayIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button, AnimatedHeroImage, Divider } from "../../common";
import {
  formatRelativeDate,
  getDominantColorFromImage,
} from "../../../helpers";

import "./hero.scss";

interface LibraryHeroProps {
  lastPlayedGames: LibraryGame[];
}

interface HeroBackgroundLayer {
  key: number;
  imageUrl: string;
  role: "base" | "incoming";
  isVisible: boolean;
}

const FEATURED_GAME_INTERVAL = 60000;
function getLastPlayedLabel(lastTimePlayed: Date | string | null | undefined) {
  const relativeDate = formatRelativeDate(lastTimePlayed, {
    fallback: "recently",
  });

  return `Last played ${relativeDate}`;
}

function formatPlaytime(playTimeInMilliseconds?: number | null) {
  if (!playTimeInMilliseconds) return "0h";

  const totalHours = Math.max(
    1,
    Math.round(playTimeInMilliseconds / 3_600_000)
  );

  return `${totalHours}h`;
}

export function LibraryHero({ lastPlayedGames }: Readonly<LibraryHeroProps>) {
  const [featuredGameIndex, setFeaturedGameIndex] = useState(0);
  const [dominantColor, setDominantColor] = useState<string | null>(null);
  const [backgroundLayers, setBackgroundLayers] = useState<
    HeroBackgroundLayer[]
  >([]);
  const featuredGame = lastPlayedGames[featuredGameIndex] ?? null;

  useEffect(() => {
    if (lastPlayedGames.length <= 1) {
      setFeaturedGameIndex(0);
      return;
    }

    const intervalId = globalThis.setInterval(() => {
      setFeaturedGameIndex((currentIndex) => {
        return (currentIndex + 1) % lastPlayedGames.length;
      });
    }, FEATURED_GAME_INTERVAL);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [lastPlayedGames]);

  useEffect(() => {
    let isMounted = true;

    getDominantColorFromImage(featuredGame?.libraryHeroImageUrl).then(
      (nextColor) => {
        if (!isMounted) return;

        setDominantColor(nextColor);
      }
    );

    return () => {
      isMounted = false;
    };
  }, [featuredGame?.libraryHeroImageUrl]);

  useEffect(() => {
    const nextImageUrl = featuredGame?.libraryHeroImageUrl ?? "";

    if (!nextImageUrl) {
      setBackgroundLayers([]);
      return;
    }

    setBackgroundLayers((currentLayers) => {
      const baseLayer =
        currentLayers.find((layer) => layer.role === "base") ?? null;
      const incomingLayer =
        currentLayers.find((layer) => layer.role === "incoming") ?? null;

      if (
        baseLayer?.imageUrl === nextImageUrl ||
        incomingLayer?.imageUrl === nextImageUrl
      ) {
        return currentLayers;
      }

      if (!baseLayer) {
        return [
          {
            key: Date.now(),
            imageUrl: nextImageUrl,
            role: "base",
            isVisible: true,
          },
        ];
      }

      return [
        baseLayer,
        {
          key: Date.now() + 1,
          imageUrl: nextImageUrl,
          role: "incoming",
          isVisible: false,
        },
      ];
    });
  }, [featuredGame?.libraryHeroImageUrl]);

  const achievementCount =
    featuredGame?.unlockedAchievementCount ??
    featuredGame?.achievementCount ??
    0;
  const playtime = formatPlaytime(featuredGame?.playTimeInMilliseconds);
  const lastPlayedLabel = getLastPlayedLabel(featuredGame?.lastTimePlayed);

  const handleIncomingImageLoad = (layerKey: number) => {
    setBackgroundLayers((currentLayers) => {
      return currentLayers.map((layer) => {
        if (layer.key !== layerKey || layer.role !== "incoming") return layer;

        return {
          ...layer,
          isVisible: true,
        };
      });
    });
  };

  const handleIncomingImageError = (layerKey: number) => {
    setBackgroundLayers((currentLayers) => {
      return currentLayers.filter((layer) => layer.key !== layerKey);
    });
  };

  const handleIncomingTransitionEnd = (layerKey: number) => {
    setBackgroundLayers((currentLayers) => {
      const incomingLayer = currentLayers.find(
        (layer) => layer.key === layerKey && layer.role === "incoming"
      );

      if (!incomingLayer?.isVisible) return currentLayers;

      return currentLayers
        .filter((layer) => layer.key === layerKey)
        .map((layer) => ({
          ...layer,
          role: "base" as const,
          isVisible: true,
        }));
    });
  };

  return (
    <section className="hero">
      {backgroundLayers.map((layer) => (
        <div
          key={layer.key}
          className={`hero__bg-layer hero__bg-layer--${layer.role} ${
            layer.isVisible ? "hero__bg-layer--visible" : ""
          }`.trim()}
          onTransitionEnd={() => {
            if (layer.role !== "incoming") return;
            handleIncomingTransitionEnd(layer.key);
          }}
        >
          <AnimatedHeroImage
            className="hero__bg"
            imageUrl={layer.imageUrl}
            onLoad={() => {
              if (layer.role !== "incoming") return;
              handleIncomingImageLoad(layer.key);
            }}
            onError={() => {
              if (layer.role !== "incoming") return;
              handleIncomingImageError(layer.key);
            }}
          />
        </div>
      ))}

      <div className="hero__overlay" />

      <div className="hero__content">
        <div className="hero__content__left">
          <div className="hero__logo">
            {featuredGame?.logoImageUrl ? (
              <img
                src={featuredGame.logoImageUrl}
                alt={featuredGame.title}
                className="hero__logo__image"
              />
            ) : (
              <span className="hero__logo__fallback">
                {featuredGame?.title ?? ""}
              </span>
            )}
          </div>

          <div className="hero__copy">
            <p className="hero__eyebrow">Continue playing:</p>
            <p className="hero__description">{lastPlayedLabel}</p>
          </div>

          <div className="hero__actions">
            <Button
              variant="primary"
              icon={<PlayIcon size={24} />}
              color={dominantColor ?? undefined}
              onClick={() => {}}
            >
              Launch Game
            </Button>

            <div className="hero__action__divider">
              <Divider orientation="vertical" />
            </div>

            <Button
              variant="secondary"
              icon={<GearIcon size={24} />}
              onClick={() => {}}
            >
              Options
            </Button>

            <Button variant="secondary" size="icon" onClick={() => {}}>
              <HeartIcon size={24} />
            </Button>
          </div>
        </div>

        <div className="hero__stats">
          <div className="hero__stat hero__stat--achievements">
            <div className="hero__stat__value">
              <TrophyIcon size={28} />
              <span>{achievementCount}</span>
            </div>

            <div className="hero__stat__label">Achievements</div>
          </div>

          <div className="hero__stat hero__stat--playtime">
            <div className="hero__stat__value">
              <ClockIcon size={28} />
              <span>{playtime}</span>
            </div>
            <div className="hero__stat__label">Hours Played</div>
          </div>
        </div>
      </div>
    </section>
  );
}
