import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { ClockIcon, TrophyIcon, AlertFillIcon } from "@primer/octicons-react";

import { buildGameDetailsPath } from "@renderer/helpers";

import type { HomeRowGame } from "./home-game-card";
import { CardFriendsBadge } from "./card-friends-badge";

import "./home-recently-played-card.scss";

/* The Recently Played row's card. The user explicitly asked it to
   match the Library page's card pattern: a glassmorphic playtime
   pill in the top-left, an optional classics platform badge in the
   top-right, and an achievement progress bar pinned to the bottom
   (trophy icon + "X/Y" + percentage + filled muted-color bar).
   Same visual language as `library-game-card.tsx` — just laid out
   horizontally so the row reads as a header-banner shelf instead of
   the library page's portrait grid. */

interface HomeRecentlyPlayedCardProps {
  game: HomeRowGame;
  /** Optional manual-playtime flag — surfaces the warning icon the
   *  library card shows when a user has edited their hours. Home
   *  rows don't carry this today; left optional so the API is
   *  ready when the row starts plumbing it through. */
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

/** Mirrors the library page's `formatPlayTime` (use-game-card.ts)
 *  but inlined so this card doesn't require a full LibraryGame. We
 *  intentionally match the long-form output ("12 hours" / "30
 *  minutes") rather than the compact "h/m" form — the library card
 *  uses the long form at this card's width too. */
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

  /* PC uses the Steam hero; classics fall back through cover → blur
     since most launchbox entries don't have a libraryHeroImageUrl. */
  const heroSrc = resolveImageSrc(
    isClassics
      ? (game.coverImageUrl ?? game.libraryHeroImageUrl ?? game.libraryImageUrl)
      : (game.libraryHeroImageUrl ?? game.libraryImageUrl ?? game.coverImageUrl)
  );
  const logoSrc = resolveImageSrc(game.logoImageUrl);

  /* Classics platform label + emulator icon used to render in the
     top-right cluster but were removed at the user's request — the
     ShopLogo + the centered box-art already make the platform
     obvious for classics. */
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

/* React.memo with custom comparator — recently-played cards
   re-render the most often because they carry playtime + achievement
   progress that updates while the user is in-game. Compare the
   identity + the visible-data fields (playtime, achievement count,
   unlocked count) so legitimate stat updates still trigger a
   re-render but unrelated parent re-renders don't. */
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
