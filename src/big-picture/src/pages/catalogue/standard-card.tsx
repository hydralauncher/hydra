import { QuestionIcon } from "@phosphor-icons/react";
import { CatalogueCardShell, type CatalogueCardProps } from "./card-shell";

export function CatalogueStandardCard({
  game,
  navigationOverrides,
}: Readonly<CatalogueCardProps>) {
  return (
    <CatalogueCardShell
      game={game}
      navigationOverrides={navigationOverrides}
      imageContent={
        game.libraryImageUrl ? (
          <img
            className="catalogue-card__wide-image"
            src={game.libraryImageUrl}
            alt={game.title}
            loading="lazy"
          />
        ) : (
          <div className="catalogue-card__image-placeholder">
            <QuestionIcon size={28} />
          </div>
        )
      }
    />
  );
}
