import { UserProfile } from "@types";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { ProfileSkeleton } from "./profile-skeleton";
import { ProfileContent } from "./profile-content";

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

  if (!userProfile) return <ProfileSkeleton />;

  return <ProfileContent userProfile={userProfile} />;
};
