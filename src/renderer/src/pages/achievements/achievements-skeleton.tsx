import Skeleton from "react-loading-skeleton";
import "./achievements.scss";

export function AchievementsSkeleton() {
  return (
    <div className="achievements__container">
      <div className="achievements__hero">
        <Skeleton className="achievements__hero-image-skeleton" />
      </div>
      <div className="achievements__hero-panel-skeleton"></div>
    </div>
  );
}
