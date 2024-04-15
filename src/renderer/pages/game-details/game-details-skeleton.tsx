import Skeleton from "react-loading-skeleton";

import { Button } from "@renderer/components";
import * as styles from "./game-details.css";
import { useTranslation } from "react-i18next";

export function GameDetailsSkeleton() {
  const { t } = useTranslation("game_details");

  return (
    <div className={styles.container}>
      <Skeleton className={styles.heroImage} height={400} />
      <div className={styles.descriptionHeader}>
        <section className={styles.descriptionHeaderInfo}>
          <Skeleton width={200} />
          <Skeleton width={200} />
        </section>

        <Button theme="outline" disabled>
          <Skeleton width={150} />
        </Button>
      </div>
      <div className={styles.descriptionContainer}>
        <div className={styles.descriptionContent}>
          <div className={styles.descriptionHeader}>
            <section className={styles.descriptionHeaderInfo}>
              <Skeleton width={200} />
              <Skeleton width={200} />
            </section>
            <Button theme="outline" disabled>
              <Skeleton width={150} />
            </Button>
          </div>
          <div
            className={styles.description}
            style={{
              width: "100%",
            }}
          >
            <Skeleton
              count={4}
              width={"100%"}
              height={20}
              style={{ display: "flex" }}
            />
            <Skeleton
              className={styles.heroImage}
              height={300}
              style={{
                marginBottom: "12px",
              }}
            />
            <Skeleton
              count={2}
              width={"100%"}
              height={20}
              style={{ display: "flex" }}
            />
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
          <div className={styles.requirementsDetails}>
            <Skeleton count={6} height={18} />
          </div>
        </div>
      </div>
    </div>
  );
}
