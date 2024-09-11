import Skeleton from "react-loading-skeleton";
import cn from "classnames";
import * as styles from "./profile.css";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useTranslation } from "react-i18next";

export function ProfileSkeleton() {
  const { t } = useTranslation("user_profile");

  return (
    <>
      <Skeleton className={styles.profileHeaderSkeleton} />
      <div className={styles.profileContent}>
        <div className={styles.profileGameSection}>
          <h2>{t("activity")}</h2>
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton
              key={index}
              height={72}
              style={{ flex: "1", width: "100%" }}
            />
          ))}
        </div>

        <div className={cn(styles.contentSidebar, styles.profileGameSection)}>
          <h2>{t("library")}</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: `${SPACING_UNIT}px`,
            }}
          >
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} style={{ aspectRatio: "1" }} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
