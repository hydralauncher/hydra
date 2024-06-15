import Skeleton from "react-loading-skeleton";
import * as styles from "./user.css";

export const UserSkeleton = () => {
  return (
    <>
      <Skeleton className={styles.profileHeaderSkeleton} />
      <Skeleton width={135} />
    </>
  );
};
