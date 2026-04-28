import "./styles.scss";

interface GameCardProps {
  coverImageUrl?: string | null;
  gameTitle: string;
}

function GameCard({ coverImageUrl, gameTitle }: Readonly<GameCardProps>) {
  return (
    <div className="big-picture__game-card">
      <div className="big-picture__game-card__cover">
        {coverImageUrl ? (
          <img src={coverImageUrl} alt={gameTitle} draggable={false} />
        ) : (
          <div className="big-picture__game-card__cover--placeholder" />
        )}
      </div>
      <span className="big-picture__game-card__title">{gameTitle}</span>
    </div>
  );
}

export { GameCard };
