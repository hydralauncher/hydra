import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import type { HowLongToBeatCategory } from "@types";
import { vars } from "@renderer/theme.css";
import * as styles from "./sidebar.css";

const durationTranslation: Record<string, string> = {
  Hours: "hours",
  Mins: "minutes",
};

export interface HowLongToBeatSectionProps {
  howLongToBeatData: HowLongToBeatCategory[] | null;
  isLoading: boolean;
}

export function HowLongToBeatSection({
  howLongToBeatData,
  isLoading,
}: HowLongToBeatSectionProps) {
  const { t } = useTranslation("game_details");

  const getDuration = (duration: string) => {
    const [value, unit] = duration.split(" ");
    return `${value} ${t(durationTranslation[unit])}`;
  };

  if (!howLongToBeatData && !isLoading) return null;

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <div className={styles.contentSidebarTitle}>
        <h3>HowLongToBeat</h3>
      </div>

      <ul className={styles.howLongToBeatCategoriesList}>
        {howLongToBeatData
          ? howLongToBeatData.map((category) => (
              <li key={category.title} className={styles.howLongToBeatCategory}>
                <p
                  className={styles.howLongToBeatCategoryLabel}
                  style={{
                    fontWeight: "bold",
                  }}
                >
                  {category.title}
                </p>

                <p className={styles.howLongToBeatCategoryLabel}>
                  {getDuration(category.duration)}
                </p>

                {category.accuracy !== "00" && (
                  <small>
                    {t("accuracy", { accuracy: category.accuracy })}
                  </small>
                )}
              </li>
            ))
          : Array.from({ length: 4 }).map((_, index) => (
              <Skeleton
                key={index}
                className={styles.howLongToBeatCategorySkeleton}
              />
            ))}
      </ul>
    </SkeletonTheme>
  );
}
