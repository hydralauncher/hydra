import { useContext } from "react";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import type { HowLongToBeatCategory } from "@types";
import { gameDetailsContext } from "@renderer/context";
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
  const { gameTitle } = useContext(gameDetailsContext);

  const getDuration = (duration: string) => {
    const [value, unit] = duration.split(" ");
    return `${value} ${t(durationTranslation[unit] ?? unit)}`;
  };

  if (!howLongToBeatData && !isLoading) return null;

  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <SidebarSection
        title="HowLongToBeat"
        subtitle={gameTitle ? "howlongtobeat.com" : undefined}
        subtitleHref={
          gameTitle
            ? `https://howlongtobeat.com/?q=${encodeURIComponent(gameTitle)}`
            : undefined
        }
      >
        <ul className="how-long-to-beat__categories-list">
          {howLongToBeatData
            ? howLongToBeatData.map((category) => (
                <li key={category.title} className="how-long-to-beat__category">
                  <div className="how-long-to-beat__category-header">
                    <p className="how-long-to-beat__category-label how-long-to-beat__category-label--bold">
                      {category.title}
                    </p>
                    {category.accuracy !== "00" && (
                      <small className="how-long-to-beat__category-accuracy">
                        {t("accuracy", { accuracy: category.accuracy })}
                      </small>
                    )}
                  </div>

                  <p className="how-long-to-beat__category-duration">
                    {getDuration(category.duration)}
                  </p>
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
