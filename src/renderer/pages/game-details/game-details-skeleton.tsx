import Skeleton from "react-loading-skeleton";

import { Button } from "@renderer/components";
import { useTranslation } from "react-i18next";
import * as styles from "./game-details.css";

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
          <div className={styles.description}>
            <Skeleton
              count={8}
              width={"100%"}
              height={20}
              style={{ display: "flex", gap: "8px" }}
            />
          </div>
        </div>
        <div className={styles.requirements}>
          <div className={styles.requirementsHeader}>
            <Skeleton width={200} />
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
            <Skeleton count={5} style={{ display: "flex", gap: "1px" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
