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
import { useTranslation } from "react-i18next";

export const User = () => {
  const { userId } = useParams();
  const [userProfile, setUserProfile] = useState<UserProfile>();
  const navigate = useNavigate();

  const { t } = useTranslation("user_profile");

  const { showErrorToast } = useToast();

  const dispatch = useAppDispatch();

  const getUserProfile = useCallback(() => {
    return window.electron.getUser(userId!).then((userProfile) => {
      if (userProfile) {
        dispatch(setHeaderTitle(userProfile.displayName));
        setUserProfile(userProfile);
      } else {
        showErrorToast(t("user_not_found"));
        navigate(-1);
      }
    });
  }, [dispatch, navigate, showErrorToast, userId, t]);

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
