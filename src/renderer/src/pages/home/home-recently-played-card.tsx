import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { ClockIcon, TrophyIcon, AlertFillIcon } from "@primer/octicons-react";

import { buildGameDetailsPath } from "@renderer/helpers";

import type { HomeRowGame } from "./home-game-card";
import { CardFriendsBadge } from "./card-friends-badge";

import "./home-recently-played-card.scss";

interface HomeRecentlyPlayedCardProps {
  game: HomeRowGame;
  hasManuallyUpdatedPlaytime?: boolean;
}

const resolveImageSrc = (
  url: string | null | undefined
): string | undefined => {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  )
    return trimmed;
  if (trimmed.startsWith("local:"))
    return `local:${trimmed.slice("local:".length).replaceAll("\\", "/")}`;
  const normalized = trimmed.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/"))
    return `local:${normalized}`;
  return normalized;
};

const formatPlayTimeLong = (ms: number | undefined | null): string => {
  if (!ms || ms <= 0) return "0 minutes";
  const minutes = ms / 60000;
  if (minutes < 120) {
    return `${Math.max(1, Math.round(minutes))} minutes`;
  }
  const hours = minutes / 60;
  const formatted =
    hours >= 100 ? Math.round(hours).toString() : hours.toFixed(1);
  return `${formatted} hours`;
};

function HomeRecentlyPlayedCardImpl({
  game,
  hasManuallyUpdatedPlaytime = false,
}: HomeRecentlyPlayedCardProps) {
  const navigate = useNavigate();

  const isClassics = game.shop === "launchbox";

  const heroSrc = resolveImageSrc(
    isClassics
      ? (game.coverImageUrl ?? game.libraryHeroImageUrl ?? game.libraryImageUrl)
      : (game.libraryHeroImageUrl ?? game.libraryImageUrl ?? game.coverImageUrl)
  );
  const logoSrc = resolveImageSrc(game.logoImageUrl);

  const playtimeText = formatPlayTimeLong(game.playTimeInMilliseconds);

  const hasAchievements =
    typeof game.achievementCount === "number" && game.achievementCount > 0;
  const unlocked = game.unlockedAchievementCount ?? 0;
  const total = game.achievementCount ?? 0;
  const percentage = total > 0 ? Math.round((unlocked / total) * 100) : 0;
  const isCompleted = hasAchievements && unlocked === total && total > 0;

  return (
    <button
      type="button"
      className={`home-recently-played-card${
        isClassics ? " home-recently-played-card--classics" : ""
      }${isCompleted ? " home-recently-played-card--completed" : ""}`}
      onClick={() => navigate(buildGameDetailsPath(game))}
      title={game.title}
    >
      {/* ── Image layer ─────────────────────────────────── */}
      {isClassics && heroSrc && (
        <img
          src={heroSrc}
          alt=""
          aria-hidden="true"
          className="home-recently-played-card__blur-bg"
          loading="lazy"
          decoding="async"
        />
      )}
      {heroSrc && (
        <img
          src={heroSrc}
          alt={game.title}
          className={`home-recently-played-card__cover-image${
            isClassics ? " home-recently-played-card__cover-image--contain" : ""
          }`}
          loading="lazy"
          decoding="async"
        />
      )}

      {/* ── Overlay (mirrors library-game-card.tsx structure) ── */}
      <div
        className={`home-recently-played-card__overlay${
          isClassics ? " home-recently-played-card__overlay--classics" : ""
        }`}
      >
        <div className="home-recently-played-card__top-section">
          <div className="home-recently-played-card__playtime">
            {hasManuallyUpdatedPlaytime ? (
              <AlertFillIcon
                size={11}
                className="home-recently-played-card__manual-playtime"
              />
            ) : (
              <ClockIcon size={11} />
            )}
            <span>{playtimeText}</span>
          </div>

          {/* Right cluster — only the friends-playing badge now.
              The classics platform label ("PS2") + emulator icon
              ("PCSX2") cluster used to live here but the user
              asked to remove it from the recently-played row; the
              ShopLogo in the top-left already encodes the platform
              for classics and the card's blurred-portrait layout
              makes the system obvious from the art itself.
              CardFriendsBadge renders null when no friends play
              this game so the slot collapses for solo titles. */}
          <div className="home-recently-played-card__top-right">
            <CardFriendsBadge game={game} />
          </div>
        </div>

        {/* Logo overlay — sits above the achievement strip so it
            doesn't fight the playtime pill at the top. Restored
            for classics too: the user wants the game logo visible
            on top of the framed cover so the row reads consistently
            (every card shows the logo) regardless of whether the
            backdrop is a PC hero or the centered classic cover.
            The classics z-stack: blur backdrop (z 0) → centered
            cover (z 1) → overlay including this logo (z 3). */}
        {logoSrc && (
          <div className="home-recently-played-card__logo" aria-hidden="true">
            <img
              src={logoSrc}
              alt=""
              className="home-recently-played-card__logo-image"
              loading="lazy"
              decoding="async"
            />
          </div>
        )}

        {hasAchievements && (
          <div className="home-recently-played-card__achievements">
            <div className="home-recently-played-card__achievement-header">
              <div className="home-recently-played-card__achievements-gap">
                <TrophyIcon
                  size={13}
                  className="home-recently-played-card__achievement-trophy"
                />
                <span className="home-recently-played-card__achievement-count">
                  {unlocked} / {total}
                </span>
              </div>
              <span className="home-recently-played-card__achievement-percentage">
                {percentage}%
              </span>
            </div>
            <div className="home-recently-played-card__achievement-progress">
              <div
                className="home-recently-played-card__achievement-bar"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </button>
  );
}

export const HomeRecentlyPlayedCard = memo(
  HomeRecentlyPlayedCardImpl,
  (prev, next) => {
    const a = prev.game;
    const b = next.game;
    return (
      a.shop === b.shop &&
      a.objectId === b.objectId &&
      a.title === b.title &&
      a.libraryImageUrl === b.libraryImageUrl &&
      a.libraryHeroImageUrl === b.libraryHeroImageUrl &&
      a.coverImageUrl === b.coverImageUrl &&
      a.logoImageUrl === b.logoImageUrl &&
      a.playTimeInMilliseconds === b.playTimeInMilliseconds &&
      a.achievementCount === b.achievementCount &&
      a.unlockedAchievementCount === b.unlockedAchievementCount &&
      prev.hasManuallyUpdatedPlaytime === next.hasManuallyUpdatedPlaytime
    );
  }
);
