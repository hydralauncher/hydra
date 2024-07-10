import { UserProfile } from "@types";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useToast } from "@renderer/hooks";
import { UserSkeleton } from "./user-skeleton";
import { UserContent } from "./user-content";
import { SkeletonTheme } from "react-loading-skeleton";
import { vars } from "@renderer/theme.css";
import * as styles from "./user.css";

export const User = () => {
  const { userId } = useParams();
  const [userProfile, setUserProfile] = useState<UserProfile>();
  const navigate = useNavigate();

  const { showErrorToast } = useToast();

  const dispatch = useAppDispatch();

  const getUserProfile = useCallback(() => {
    return window.electron.getUser(userId!).then((userProfile) => {
      if (userProfile) {
        dispatch(setHeaderTitle(userProfile.displayName));
        setUserProfile(userProfile);
      } else {
        showErrorToast("Usuário não encontrado");
        navigate(-1);
      }
    });
  }, [dispatch, userId]);

  useEffect(() => {
    getUserProfile();
  }, [getUserProfile]);

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <div className={styles.wrapper}>
        {userProfile ? (
          <UserContent
            userProfile={userProfile}
            updateUserProfile={getUserProfile}
          />
        ) : (
          <UserSkeleton />
        )}
      </div>
    </SkeletonTheme>
  );
};
