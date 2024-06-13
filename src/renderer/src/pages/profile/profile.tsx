import { UserProfile } from "@types";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { ProfileSkeleton } from "./profile-skeleton";
import { ProfileContent } from "./profile-content";
import { SkeletonTheme } from "react-loading-skeleton";
import { vars } from "@renderer/theme.css";
import * as styles from "./profile.css";

export const Profile = () => {
  const { username } = useParams();
  const [userProfile, setUserProfile] = useState<UserProfile>();

  const dispatch = useAppDispatch();

  useEffect(() => {
    window.electron.getUserProfile(username!).then((userProfile) => {
      if (userProfile) {
        dispatch(setHeaderTitle(userProfile.username));
        setUserProfile(userProfile);
      }
    });
  }, [dispatch]);

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <div className={styles.wrapper}>
        {userProfile ? (
          <ProfileContent userProfile={userProfile} />
        ) : (
          <ProfileSkeleton />
        )}
      </div>
    </SkeletonTheme>
  );
};
