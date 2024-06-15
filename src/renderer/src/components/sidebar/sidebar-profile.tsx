import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type UserProfile } from "@types";
import * as styles from "./sidebar.css";
import { PersonIcon } from "@primer/octicons-react";

export function SidebarProfile() {
  const navigate = useNavigate();

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isUserProfileLoading, setIsUserProfileLoading] = useState(true);

  const handleClickProfile = () => {
    navigate(`/profile/${userProfile!.id}`);
  };

  const handleClickLogin = () => {
    window.electron.openExternal("https://losbroxas.org");
  };

  useEffect(() => {
    setIsUserProfileLoading(true);
    window.electron.isUserLoggedIn().then(async (isLoggedIn) => {
      if (isLoggedIn) {
        const userProfile = await window.electron.getMe();
        setUserProfile(userProfile);
      }

      setIsUserProfileLoading(false);
    });
  }, []);

  if (isUserProfileLoading) return null;

  if (userProfile == null) {
    return (
      <>
        <button
          type="button"
          className={styles.profileButton}
          onClick={handleClickLogin}
        >
          <div className={styles.profileAvatar}>
            <PersonIcon />
          </div>

          <div className={styles.profileButtonInformation}>
            <p style={{ fontWeight: "bold" }}>Fazer login</p>
          </div>
        </button>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className={styles.profileButton}
        onClick={handleClickProfile}
      >
        <div className={styles.profileAvatar}>
          {userProfile.profileImageUrl ? (
            <img
              className={styles.profileAvatar}
              src={userProfile.profileImageUrl}
              alt={userProfile.displayName}
            />
          ) : (
            <PersonIcon />
          )}
        </div>

        <div className={styles.profileButtonInformation}>
          <p style={{ fontWeight: "bold" }}>{userProfile.displayName}</p>
        </div>
      </button>
    </>
  );
}
