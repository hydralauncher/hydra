import { UserProfile } from "@types";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { UserSkeleton } from "./user-skeleton";
import { UserContent } from "./user-content";
import { SkeletonTheme } from "react-loading-skeleton";
import { vars } from "@renderer/theme.css";
import * as styles from "./user.css";

export const User = () => {
  const { userId } = useParams();
  const [userProfile, setUserProfile] = useState<UserProfile>();

  const dispatch = useAppDispatch();

  const getUserProfile = useCallback(() => {
    window.electron.getUser(userId!).then((userProfile) => {
      if (userProfile) {
        dispatch(setHeaderTitle(userProfile.displayName));
        setUserProfile(userProfile);
      }
    });
  }, [dispatch, userId]);

  useEffect(() => {
    getUserProfile();
  }, [getUserProfile]);

  const handleUpdateProfile = () => {
    getUserProfile();
  };

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <div className={styles.wrapper}>
        {userProfile ? (
          <UserContent
            userProfile={userProfile}
            updateUserProfile={handleUpdateProfile}
          />
        ) : (
          <UserSkeleton />
        )}
      </div>
    </SkeletonTheme>
  );
};
