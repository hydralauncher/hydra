import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import type { HowLongToBeatCategory } from "@types";
import { SidebarSection } from "../sidebar-section/sidebar-section";

import "./sidebar.scss";
import "../../../scss/_variables.scss";

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
    <SkeletonTheme baseColor="var(--background-color)" highlightColor="#444">
      <SidebarSection title="HowLongToBeat">
        <ul className="sidebar__how-long-to-beat-categories-list">
          {howLongToBeatData
            ? howLongToBeatData.map((category) => (
                <li
                  key={category.title}
                  className="sidebar__how-long-to-beat-category"
                >
                  <p
                    className="sidebar__how-long-to-beat-category-label"
                    style={{
                      fontWeight: "bold",
                    }}
                  >
                    {category.title}
                  </p>

                  <p className="sidebar__how-long-to-beat-category-label">
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
                  className="sidebar__how-long-to-beat-category-skeleton"
                />
              ))}
        </ul>
      </SidebarSection>
    </SkeletonTheme>
  );
}
