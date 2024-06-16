import { UserProfile } from "@types";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { UserSkeleton } from "./user-skeleton";
import { UserContent } from "./user-content";
import { SkeletonTheme } from "react-loading-skeleton";
import { vars } from "@renderer/theme.css";
import * as styles from "./user.css";
import { UserAuthContextProvider } from "@renderer/context/user-auth/user-auth.context";

export const User = () => {
  const { username } = useParams();
  const [userProfile, setUserProfile] = useState<UserProfile>();

  const dispatch = useAppDispatch();

  useEffect(() => {
    window.electron.getUser(username!).then((userProfile) => {
      if (userProfile) {
        dispatch(setHeaderTitle(userProfile.displayName));
        setUserProfile(userProfile);
      }
    });
  }, [dispatch, username]);

  return (
    <UserAuthContextProvider>
      <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
        <div className={styles.wrapper}>
          {userProfile ? (
            <UserContent userProfile={userProfile} />
          ) : (
            <UserSkeleton />
          )}
        </div>
      </SkeletonTheme>
    </UserAuthContextProvider>
  );
};
