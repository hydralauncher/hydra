import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
import { formatBytes } from "@shared";
import type { SeedingStatus, LibraryGame } from "@types";

import "./seeding-hover-card.scss";

export interface SeedingHoverCardProps {
  seedingStatus: SeedingStatus[];
  library: LibraryGame[];
  position: { x: number; y: number };
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function SeedingHoverCard({
  seedingStatus,
  library,
  position,
  onMouseEnter,
  onMouseLeave,
}: SeedingHoverCardProps) {
  const { t } = useTranslation("bottom_panel");

  const gamesWithStatus = seedingStatus
    .map((status) => {
      const game = library.find((g) => g.id === status.gameId);
      return game ? { game, uploadSpeed: status.uploadSpeed } : null;
    })
    .filter(
      (item): item is { game: LibraryGame; uploadSpeed: number } =>
        item !== null
    );

  if (gamesWithStatus.length === 0) return null;

  const cardContent = (
    <div
      className="seeding-hover-card"
      style={{ left: position.x, bottom: position.y }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="seeding-hover-card__title">
        {t("seeding_games", { count: gamesWithStatus.length })}
      </div>

      {gamesWithStatus.map(({ game, uploadSpeed }) => (
        <div key={game.id} className="seeding-hover-card__game">
          {game.iconUrl ? (
            <img
              className="seeding-hover-card__game-icon"
              src={game.iconUrl}
              alt={game.title}
            />
          ) : (
            <div className="seeding-hover-card__game-icon-fallback">
              <Upload size={14} />
            </div>
          )}

          <div className="seeding-hover-card__game-info">
            <span className="seeding-hover-card__game-title">{game.title}</span>
            <span className="seeding-hover-card__game-speed">
              {uploadSpeed > 0 ? `${formatBytes(uploadSpeed)}/s` : "0 B/s"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );

  return createPortal(cardContent, document.body);
}
