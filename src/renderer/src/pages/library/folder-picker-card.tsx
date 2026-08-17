import { memo, useState } from "react";
import { CheckIcon, ImageIcon } from "@primer/octicons-react";
import { LibraryGame } from "@types";
import "./folder-game-picker.scss";

interface FolderPickerCardProps {
  game: LibraryGame;
  isSelected: boolean;
  onToggle: (game: LibraryGame) => void;
}

export const FolderPickerCard = memo(function FolderPickerCard({
  game,
  isSelected,
  onToggle,
}: Readonly<FolderPickerCardProps>) {
  const [imgError, setImgError] = useState(false);

  const coverSrc = (() => {
    if (imgError) return "";
    return (
      game.libraryImageUrl ||
      game.coverImageUrl ||
      (game.shop === "steam"
        ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/header.jpg`
        : "") ||
      game.iconUrl ||
      ""
    );
  })();

  return (
    <button
      type="button"
      className={`folder-picker-card${isSelected ? " folder-picker-card--selected" : ""}`}
      onClick={() => onToggle(game)}
      aria-pressed={isSelected}
      title={game.title}
    >
      <div className="folder-picker-card__cover-wrap">
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={game.title}
            className="folder-picker-card__cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="folder-picker-card__placeholder">
            <ImageIcon size={24} />
          </div>
        )}
      </div>

      <div className="folder-picker-card__info">
        <span className="folder-picker-card__title">{game.title}</span>
      </div>

      <div
        className={`folder-picker-card__checkbox${isSelected ? " folder-picker-card__checkbox--checked" : ""}`}
        aria-hidden="true"
      >
        {isSelected && <CheckIcon size={10} />}
      </div>
    </button>
  );
});
