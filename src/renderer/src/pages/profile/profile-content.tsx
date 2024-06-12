import { UserProfile } from "@types";
import { useTranslation } from "react-i18next";

export interface ProfileContentProps {
  userProfile: UserProfile;
}

export const ProfileContent = ({ userProfile }: ProfileContentProps) => {
  const { t } = useTranslation("profile");

  return (
    <>
      <p>{userProfile.username}</p>
    </>
  );
};
