function BoardImage({ url }: Readonly<{ url: string | null }>) {
  return url ? (
    <img
      className="leaderboards__board-cover"
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
    />
  ) : (
    <span className="leaderboards__board-cover" />
  );
}

export interface BoardHeaderProps {
  id: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  imageUrl?: string | null;
  // With a link, the cover and the title open it.
  onOpen?: () => void;
  aside?: React.ReactNode;
}

export function BoardHeader({
  id,
  title,
  description,
  icon,
  imageUrl = null,
  onOpen,
  aside,
}: Readonly<BoardHeaderProps>) {
  const media = icon ? (
    <span className="leaderboards__board-icon">{icon}</span>
  ) : (
    <BoardImage url={imageUrl} />
  );

  return (
    <div className="leaderboards__board-header">
      {onOpen ? (
        <button
          type="button"
          className="leaderboards__board-media-link"
          tabIndex={-1}
          aria-hidden="true"
          onClick={onOpen}
        >
          {media}
        </button>
      ) : (
        media
      )}
      <div className="leaderboards__board-heading">
        <h2 id={id} className="leaderboards__board-title">
          {onOpen ? (
            <button
              type="button"
              className="leaderboards__board-title-link"
              onClick={onOpen}
            >
              {title}
            </button>
          ) : (
            title
          )}
        </h2>
        {description && (
          <p className="leaderboards__board-description">{description}</p>
        )}
      </div>
      {aside}
    </div>
  );
}
