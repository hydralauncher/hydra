import { UserProfile } from "@types";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

export const Profile = () => {
  const { username } = useParams();
  const [userProfile, setUserProfile] = useState<UserProfile>();

  const { t } = useTranslation("profile");

  return (
    <>
      <p>Tela do usuarioooooooo</p>
    </>
  );
};
