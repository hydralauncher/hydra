import { useCallback, useEffect, useRef, useState } from "react";
import type { ShopAssets, ShopDetailsWithAssets, GameStats } from "@types";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useFormat } from "@renderer/hooks";
import { DownloadIcon, PeopleIcon, PlayIcon } from "@primer/octicons-react";
import { StarRating } from "@renderer/components/star-rating/star-rating";
import { VideoPlayer } from "@renderer/pages/game-details/gallery-slider/video-player";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import cn from "classnames";

import "./catalogue-video-showcase.scss";

interface MovieData {
  hls_h264?: string;
  mp4?: { max: string; "480": string };
  webm?: { max: string; "480": string };
  thumbnail: string;
  name: string;
  highlight: boolean;
}

function getVideoSource(movie: MovieData): {
  src: string;
  type: string;
} | null {
  if (movie.hls_h264) {
    return {
      src: movie.hls_h264.replace("http://", "https://"),
      type: "application/x-mpegURL",
    };
  }
  if (movie.mp4?.max) {
    return {
      src: movie.mp4.max.replace("http://", "https://"),
      type: "video/mp4",
    };
  }
  if (movie.webm?.max) {
    return {
      src: movie.webm.max.replace("http://", "https://"),
      type: "video/webm",
    };
  }
  return null;
}

interface VideoCardProps {
  game: ShopAssets;
  index: number;
}

function VideoCard({ game, index }: VideoCardProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("catalogue");
  const { numberFormatter } = useFormat();
  const [movie, setMovie] = useState<MovieData | null>(null);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [assets, setAssets] = useState<ShopAssets | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [detailsLoaded, setDetailsLoaded] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.electron.getGameAssets(game.objectId, game.shop).then((result) => {
      if (result) setAssets(result);
    });
  }, [game.objectId, game.shop]);

  const loadDetails = useCallback(() => {
    if (detailsLoaded) return;
    setDetailsLoaded(true);

    const language = i18n.language.split("-")[0];
    window.electron
      .getGameShopDetails(game.objectId, game.shop, language)
      .then((result: ShopDetailsWithAssets | null) => {
        if (result?.movies?.length) {
          const highlight = result.movies.find((m) => m.highlight);
          setMovie(highlight ?? result.movies[0]);
        }
      });
  }, [game.objectId, game.shop, i18n.language, detailsLoaded]);

  const handleMouseEnter = useCallback(() => {
    if (!stats) {
      window.electron.getGameStats(game.objectId, game.shop).then((result) => {
        setStats(result);
      });
    }

    hoverTimerRef.current = setTimeout(() => {
      loadDetails();
      setIsHovering(true);
    }, 400);
  }, [game.objectId, game.shop, stats, loadDetails]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
    setIsHovering(false);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  const videoSource = movie ? getVideoSource(movie) : null;
  const isAvailable = game.downloadSources.length > 0;
  const showVideo = isHovering && videoSource;

  return (
    <button
      type="button"
      className={cn("video-card", {
        "video-card--unavailable": !isAvailable,
        "video-card--playing": showVideo,
      })}
      style={{ "--stagger-delay": `${index * 80}ms` } as React.CSSProperties}
      onClick={() => navigate(buildGameDetailsPath(game))}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="video-card__media">
        <img
          src={
            assets?.libraryHeroImageUrl ??
            game.libraryHeroImageUrl ??
            assets?.libraryImageUrl ??
            game.libraryImageUrl ??
            undefined
          }
          alt={game.title}
          className={cn("video-card__poster", {
            "video-card__poster--hidden": showVideo,
          })}
          loading="lazy"
        />

        {showVideo && (
          <div className="video-card__video-wrapper">
            <VideoPlayer
              videoSrc={videoSource.src}
              videoType={videoSource.type}
              poster={movie?.thumbnail}
              autoplay
              muted
              loop
              controls={false}
              className="video-card__video"
            />
          </div>
        )}

        {!showVideo && (
          <div className="video-card__play-badge">
            <PlayIcon size={16} />
          </div>
        )}

        <div className="video-card__gradient" />
      </div>

      <div className="video-card__info">
        <div className="video-card__info-main">
          <h3 className="video-card__title">{game.title}</h3>
          <span
            className={cn("video-card__availability", {
              "video-card__availability--available": isAvailable,
            })}
          >
            {isAvailable ? t("available") : t("not_available")}
          </span>
        </div>

        {stats && (
          <div className="video-card__stats">
            <div className="video-card__stat">
              <DownloadIcon size={12} />
              <span>{numberFormatter.format(stats.downloadCount)}</span>
            </div>
            <div className="video-card__stat">
              <PeopleIcon size={12} />
              <span>{numberFormatter.format(stats.playerCount)}</span>
            </div>
            <StarRating rating={stats.averageScore} size={12} />
          </div>
        )}
      </div>
    </button>
  );
}

interface CatalogueVideoShowcaseProps {
  title: string;
  games: ShopAssets[];
  isLoading?: boolean;
}

export function CatalogueVideoShowcase({
  title,
  games,
  isLoading,
}: CatalogueVideoShowcaseProps) {
  if (isLoading) {
    return (
      <section className="video-showcase">
        <h2 className="video-showcase__heading">{title}</h2>
        <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
          <div className="video-showcase__grid">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="video-showcase__skeleton" />
            ))}
          </div>
        </SkeletonTheme>
      </section>
    );
  }

  if (!games.length) return null;

  return (
    <section className="video-showcase">
      <h2 className="video-showcase__heading">{title}</h2>
      <div className="video-showcase__grid">
        {games.slice(0, 3).map((game, index) => (
          <VideoCard key={game.objectId} game={game} index={index} />
        ))}
      </div>
    </section>
  );
}
