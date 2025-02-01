import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import type { HowLongToBeatCategory } from "@types";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import "./sidebar.scss";

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
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <SidebarSection title="HowLongToBeat">
        <ul className="how-long-to-beat__categories-list">
          {howLongToBeatData
            ? howLongToBeatData.map((category) => (
                <li key={category.title} className="how-long-to-beat__category">
                  <p
                    className="how-long-to-beat__category-label"
                    style={{
                      fontWeight: "bold",
                    }}
                  >
                    {category.title}
                  </p>

                  <p className="how-long-to-beat__category-label">
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
                  className="how-long-to-beat__category-skeleton"
                />
              ))}
        </ul>
      </SidebarSection>
    </SkeletonTheme>
  );
}
