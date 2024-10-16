import Skeleton from "react-loading-skeleton";
import * as styles from "./achievements.css";

export function AchievementsSkeleton() {
  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <Skeleton className={styles.heroImageSkeleton} />
      </div>
      <div className={styles.heroPanelSkeleton}></div>
    </div>
  );
}
