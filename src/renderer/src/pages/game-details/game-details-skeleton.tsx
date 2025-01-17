import Skeleton from "react-loading-skeleton";

import { Button } from "@renderer/components";

import "./game-details.scss";

import "./sidebar/sidebar.scss";

import "./description-header/description-header.scss";

import { useTranslation } from "react-i18next";

export function GameDetailsSkeleton() {
  const { t } = useTranslation("game_details");

  return (
    <div className="game-details_container">
      <div className="game-details_hero">
        <Skeleton className="game-details__hero-image-skeleton" />
      </div>
      <div className="game-details__hero-panel-skeleton">
        <section className="description-header">
          <Skeleton width={155} />
          <Skeleton width={135} />
        </section>
      </div>
      <div className="game-details__description-container">
        <div className="game-details__description-content">
          <div className="description-header">
            <section className="description-header__info">
              <Skeleton width={145} />
              <Skeleton width={150} />
            </section>
          </div>
          <div className="game-details__description-skeleton">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} />
            ))}
            <Skeleton className="game-details__hero-image-skeleton" />
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} />
            ))}
            <Skeleton className="game-details__hero-image-skeleton" />
            <Skeleton />
          </div>
        </div>
        <div className="sidebar__content-sidebar">
          <div className="sidebar__requirements-button-container">
            <Button
              className="sidebar__requirement-button"
              theme="primary"
              disabled
            >
              {t("minimum")}
            </Button>
            <Button
              className="sidebar__requirement-button"
              theme="outline"
              disabled
            >
              {t("recommended")}
            </Button>
          </div>
          <div className="sidebar__requirements-details-skeleton">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} height={20} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
