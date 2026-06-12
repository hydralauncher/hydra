import cn from "classnames";
import { Skeleton, SourceAnchorSkeleton } from "../../components";
import type { CatalogueMode } from "./use-catalogue-data";

interface CatalogueSkeletonCardProps {
  mode: CatalogueMode;
}

export function CatalogueSkeletonCard({
  mode,
}: Readonly<CatalogueSkeletonCardProps>) {
  const isClassics = mode === "classics";

  return (
    <div className="catalogue-card catalogue-skeleton">
      <div
        className={cn(
          "catalogue-card__image",
          isClassics && "catalogue-card__image--classics-cover"
        )}
      >
        {isClassics ? (
          <>
            <Skeleton className="catalogue-card__cover-backdrop catalogue-skeleton__cover-backdrop" />
          </>
        ) : (
          <Skeleton className="catalogue-skeleton__image-fill" />
        )}
      </div>

      <div className="catalogue-card__body">
        <div className="catalogue-card__content">
          <div className="catalogue-card__content__title">
            <Skeleton className="catalogue-skeleton__title" />
          </div>

          <div className="catalogue-card__content__genres">
            <Skeleton className="catalogue-skeleton__genres" />
          </div>
        </div>

        <div className="catalogue-card__download-sources catalogue-skeleton__download-sources">
          <SourceAnchorSkeleton size="medium" />
          <SourceAnchorSkeleton size="medium" />
        </div>
      </div>
    </div>
  );
}
