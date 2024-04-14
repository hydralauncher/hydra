import type { HowLongToBeatCategory } from "@types";
import * as styles from "./game-details.css";
import { vars } from "@renderer/theme.css";
import { useTranslation } from "react-i18next";

const titleTranslation: Record<string, string> = {
  "Main Story": "main_story",
  "Main + Sides": "main_plus_sides",
  Completionist: "completionist",
  "All Styles": "all_styles",
};

const durationTranslation: Record<string, string> = {
  Hours: "hours",
  Mins: "minutes",
};

export interface HowLongToBeatSectionProps {
  howLongToBeatData: HowLongToBeatCategory[] | null;
}

export function HowLongToBeatSection({
  howLongToBeatData,
}: HowLongToBeatSectionProps) {
  const { t } = useTranslation("game_details");

  if (!howLongToBeatData) return null;

  const getDuration = (duration: string) => {
    const [value, unit] = duration.split(" ");
    return `${value} ${t(durationTranslation[unit])}`;
  };

  return (
    <>
      <div className={styles.contentSidebarTitle}>
        <h3>HowLongToBeat</h3>
      </div>

      <ul className={styles.howLongToBeatCategoriesList}>
        {howLongToBeatData.map((category) => (
          <li
            key={category.title}
            className={styles.howLongToBeatCategory}
            style={{ backgroundColor: category.color ?? vars.color.background }}
          >
            <p
              className={styles.howLongToBeatCategoryLabel}
              style={{
                fontWeight: "bold",
              }}
            >
              {titleTranslation[category.title]
                ? t(titleTranslation[category.title])
                : category.title}
            </p>
            <p className={styles.howLongToBeatCategoryLabel}>
              {getDuration(category.duration)}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
