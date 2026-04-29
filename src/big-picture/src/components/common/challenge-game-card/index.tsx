import "./styles.scss";

import { SourceAnchor } from "../source-anchor";

export interface ChallengeGameCardProps {
  coverImageUrl?: string | null;
  gameTitle: string;
  genres: string[];
  downloadSources: string[];
}

const MAX_VISIBLE_SOURCES = 3;

export function ChallengeGameCard({
  coverImageUrl,
  gameTitle,
  genres,
  downloadSources,
}: Readonly<ChallengeGameCardProps>) {
  const visibleSources = downloadSources.slice(0, MAX_VISIBLE_SOURCES);
  const hiddenSourcesCount = Math.max(
    0,
    downloadSources.length - MAX_VISIBLE_SOURCES
  );

  return (
    <div className="challenge-game-card">
      <div className="challenge-game-card__cover">
        {coverImageUrl ? (
          <img src={coverImageUrl} alt={gameTitle} draggable={false} />
        ) : (
          <div
            className="challenge-game-card__cover-placeholder"
            aria-hidden="true"
          />
        )}
      </div>

      <div className="challenge-game-card__body">
        <div className="challenge-game-card__info">
          <h3 className="challenge-game-card__title">{gameTitle}</h3>
          {genres.length > 0 ? (
            <p className="challenge-game-card__genres">{genres.join(", ")}</p>
          ) : null}
        </div>

        {visibleSources.length > 0 ? (
          <div className="challenge-game-card__sources">
            {visibleSources.map((source) => (
              <SourceAnchor key={source} title={source} />
            ))}
            {hiddenSourcesCount > 0 ? (
              <SourceAnchor title={`+${hiddenSourcesCount}`} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
