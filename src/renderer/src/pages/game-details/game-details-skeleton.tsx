import Skeleton from "react-loading-skeleton";

import { Button } from "@renderer/components";

import * as styles from "./game-details.css";
import * as sidebarStyles from "./sidebar/sidebar.css";
import * as descriptionHeaderStyles from "./description-header/description-header.css";

import { useTranslation } from "react-i18next";

export function GameDetailsSkeleton() {
  const { t } = useTranslation("game_details");

  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <Skeleton className={styles.heroImageSkeleton} />
      </div>
      <div className={styles.heroPanelSkeleton}>
        <section className={descriptionHeaderStyles.descriptionHeaderInfo}>
          <Skeleton width={155} />
          <Skeleton width={135} />
        </section>
      </div>
      <div className={styles.descriptionContainer}>
        <div className={styles.descriptionContent}>
          <div className={descriptionHeaderStyles.descriptionHeader}>
            <section className={descriptionHeaderStyles.descriptionHeaderInfo}>
              <Skeleton width={145} />
              <Skeleton width={150} />
            </section>
          </div>
          <div className={styles.descriptionSkeleton}>
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} />
            ))}
            <Skeleton className={styles.heroImageSkeleton} />
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} />
            ))}
            <Skeleton className={styles.heroImageSkeleton} />
            <Skeleton />
          </div>
        </div>
        <div className={sidebarStyles.contentSidebar}>
          <div className={sidebarStyles.contentSidebarTitle}>
            <h3>HowLongToBeat</h3>
          </div>
          <ul className={sidebarStyles.howLongToBeatCategoriesList}>
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton
                key={index}
                className={sidebarStyles.howLongToBeatCategorySkeleton}
              />
            ))}
          </ul>
          <div
            className={sidebarStyles.contentSidebarTitle}
            style={{ border: "none" }}
          >
            <h3>{t("requirements")}</h3>
          </div>
          <div className={sidebarStyles.requirementButtonContainer}>
            <Button
              className={sidebarStyles.requirementButton}
              theme="primary"
              disabled
            >
              {t("minimum")}
            </Button>
            <Button
              className={sidebarStyles.requirementButton}
              theme="outline"
              disabled
            >
              {t("recommended")}
            </Button>
          </div>
          <div className={sidebarStyles.requirementsDetailsSkeleton}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} height={20} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
