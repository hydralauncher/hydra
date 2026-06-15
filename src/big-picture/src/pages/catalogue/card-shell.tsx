import type { CatalogueSearchResult } from "@types";
import cn from "classnames";
import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FocusItem, SourceAnchor, Typography } from "../../components";
import { getBigPictureGameDetailsPath } from "../../helpers";
import type { FocusOverrides } from "../../services";
import { getCatalogueCardFocusId } from "./navigation";

type DownloadSourceSize = "small" | "medium" | "large";

export interface CatalogueCardProps {
  game: CatalogueSearchResult;
  navigationOverrides?: FocusOverrides;
}

interface CatalogueCardShellProps extends CatalogueCardProps {
  className?: string;
  imageClassName?: string;
  bodyClassName?: string;
  downloadSourcesClassName?: string;
  imageContent: ReactNode;
  downloadSourceLimit?: number;
  downloadSourceSize?: DownloadSourceSize;
  renderEmptyDownloadSources?: boolean;
}

export function CatalogueCardShell({
  game,
  navigationOverrides,
  className,
  imageClassName,
  bodyClassName,
  downloadSourcesClassName,
  imageContent,
  downloadSourceLimit = 3,
  downloadSourceSize = "medium",
  renderEmptyDownloadSources = false,
}: Readonly<CatalogueCardShellProps>) {
  const navigate = useNavigate();

  const uniqueDownloadSources = useMemo(() => {
    return Array.from(new Set(game.downloadSources));
  }, [game.downloadSources]);

  const visibleDownloadSources = uniqueDownloadSources.slice(
    0,
    downloadSourceLimit
  );
  const hiddenDownloadSourcesCount = Math.max(
    0,
    uniqueDownloadSources.length - visibleDownloadSources.length
  );

  const gamePath = getBigPictureGameDetailsPath({
    shop: game.shop,
    objectId: game.objectId,
    title: game.title,
  });

  return (
    <FocusItem
      id={getCatalogueCardFocusId(game.id)}
      actions={{
        primary: () => navigate(gamePath),
      }}
      navigationOverrides={navigationOverrides}
      asChild
    >
      <div className={cn("catalogue-card", className)}>
        <button
          type="button"
          className={cn("catalogue-card__image", imageClassName)}
          onClick={() => navigate(gamePath)}
        >
          {imageContent}
        </button>

        <div className={cn("catalogue-card__body", bodyClassName)}>
          <div className="catalogue-card__content">
            <div className="catalogue-card__content__title">
              <Typography
                variant="label"
                className="catalogue-card__content__title-text"
              >
                {game.title}
              </Typography>
            </div>

            <div className="catalogue-card__content__genres">
              <Typography
                variant="body"
                className="catalogue-card__content__genres-text"
              >
                {game.genres.slice(0, 3).join(", ")}
              </Typography>
            </div>
          </div>

          {uniqueDownloadSources.length > 0 || renderEmptyDownloadSources ? (
            <div
              className={cn(
                "catalogue-card__download-sources",
                downloadSourcesClassName,
                uniqueDownloadSources.length === 0 &&
                  "catalogue-card__download-sources--empty"
              )}
            >
              {visibleDownloadSources.map((source) => (
                <SourceAnchor
                  key={source}
                  title={source}
                  size={downloadSourceSize}
                />
              ))}

              {hiddenDownloadSourcesCount > 0 ? (
                <SourceAnchor
                  title={`+${hiddenDownloadSourcesCount}`}
                  size={downloadSourceSize}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </FocusItem>
  );
}
