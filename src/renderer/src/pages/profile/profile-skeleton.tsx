import Skeleton from "react-loading-skeleton";
import * as styles from "./profile.css";

export const ProfileSkeleton = () => {
  return (
    <>
      <Skeleton className={styles.profileHeaderSkeleton} />
      <Skeleton width={135} />
    </>
  );
};
