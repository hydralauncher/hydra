import Skeleton from "react-loading-skeleton";

import { Button } from "@renderer/components";
import * as styles from "./game-details.css";
import { useTranslation } from "react-i18next";
import { ShareAndroidIcon } from "@primer/octicons-react";

export function GameDetailsSkeleton() {
  const { t } = useTranslation("game_details");

  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <Skeleton className={styles.heroImageSkeleton} />
      </div>
      <div className={styles.descriptionHeader}>
        <section className={styles.descriptionHeaderInfo}>
          <Skeleton width={155} />
          <Skeleton width={135} />
        </section>
      </div>
      <div className={styles.descriptionContainer}>
        <div className={styles.descriptionContent}>
          <div className={styles.descriptionHeader}>
            <section className={styles.descriptionHeaderInfo}>
              <Skeleton width={145} />
              <Skeleton width={150} />
            </section>
            <Button theme="outline" disabled>
              <ShareAndroidIcon />
              {t("copy_link_to_clipboard")}
            </Button>
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
        <div className={styles.contentSidebar}>
          <div className={styles.contentSidebarTitle}>
            <h3>HowLongToBeat</h3>
          </div>
          <ul className={styles.howLongToBeatCategoriesList}>
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton
                key={index}
                className={styles.howLongToBeatCategorySkeleton}
              />
            ))}
          </ul>
          <div
            className={styles.contentSidebarTitle}
            style={{ border: "none" }}
          >
            <h3>{t("requirements")}</h3>
          </div>
          <div className={styles.requirementButtonContainer}>
            <Button
              className={styles.requirementButton}
              theme="primary"
              disabled
            >
              {t("minimum")}
            </Button>
            <Button
              className={styles.requirementButton}
              theme="outline"
              disabled
            >
              {t("recommended")}
            </Button>
          </div>
          <div className={styles.requirementsDetailsSkeleton}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} height={20} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
