import { QuestionIcon } from "@phosphor-icons/react";
import { CatalogueCardShell, type CatalogueCardProps } from "./card-shell";

export function CatalogueClassicsCard({
  game,
  navigationOverrides,
}: Readonly<CatalogueCardProps>) {
  return (
    <CatalogueCardShell
      game={game}
      navigationOverrides={navigationOverrides}
      className="catalogue-card--classics-cover"
      imageClassName="catalogue-card__image--classics-cover"
      downloadSourcesClassName="catalogue-card__download-sources--classics-cover"
      renderEmptyDownloadSources
      imageContent={
        game.libraryImageUrl ? (
          <>
            <img
              className="catalogue-card__cover-backdrop"
              src={game.libraryImageUrl}
              alt=""
              aria-hidden
              loading="lazy"
            />

            <span className="catalogue-card__cover-stage">
              <span className="catalogue-card__cover-case">
                <span className="catalogue-card__cover-case-front">
                  <img
                    src={game.libraryImageUrl}
                    alt={game.title}
                    loading="lazy"
                  />
                </span>
                <span
                  className="catalogue-card__cover-case-spine"
                  style={{ backgroundImage: `url(${game.libraryImageUrl})` }}
                  aria-hidden
                />
                <span className="catalogue-card__cover-case-edge" aria-hidden />
              </span>
            </span>
          </>
        ) : (
          <span className="catalogue-card__cover-stage">
            <div className="catalogue-card__cover-placeholder">
              <QuestionIcon size={28} />
            </div>
          </span>
        )
      }
    />
  );
}
