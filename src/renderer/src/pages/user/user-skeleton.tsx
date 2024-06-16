import Skeleton from "react-loading-skeleton";
import * as styles from "./user.css";

export const UserSkeleton = () => {
  return (
    <>
      <Skeleton className={styles.profileHeaderSkeleton} />
      <div className={styles.profileContent}>
        <Skeleton height={140} style={{ flex: 1 }} />
        <Skeleton width={300} className={styles.contentSidebar} />
      </div>
    </>
  );
};
