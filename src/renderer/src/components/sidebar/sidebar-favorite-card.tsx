import type { LibraryGame } from "@types";
import "./sidebar-favorite-card.scss";

interface SidebarFavoriteCardProps {
  game: LibraryGame;
  onClick: (event: React.MouseEvent, game: LibraryGame) => void;
}

function formatPlayTime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function getAchievementPercent(
  unlocked?: number,
  total?: number
): string | null {
  if (!total || total === 0) return null;
  const pct = Math.round(((unlocked ?? 0) / total) * 100);
  return `${pct}%`;
}

export function SidebarFavoriteCard({
  game,
  onClick,
}: Readonly<SidebarFavoriteCardProps>) {
  const cover =
    game.libraryImageUrl ?? game.coverImageUrl ?? game.iconUrl ?? null;

  const playTime = formatPlayTime(game.playTimeInMilliseconds);
  const achievement = getAchievementPercent(
    game.unlockedAchievementCount,
    game.achievementCount
  );

  return (
    <button
      type="button"
      className="sidebar-favorite-card"
      onClick={(e) => onClick(e, game)}
    >
      <div className="sidebar-favorite-card__cover">
        {cover ? (
          <img
            src={cover}
            alt={game.title}
            className="sidebar-favorite-card__image"
          />
        ) : (
          <div className="sidebar-favorite-card__placeholder" />
        )}
      </div>

      <div className="sidebar-favorite-card__info">
        <span className="sidebar-favorite-card__title">{game.title}</span>

        <div className="sidebar-favorite-card__meta">
          <span className="sidebar-favorite-card__meta-item">
            ⏱ {playTime}
          </span>
          {achievement && (
            <span className="sidebar-favorite-card__meta-item">
              🏆 {achievement}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
