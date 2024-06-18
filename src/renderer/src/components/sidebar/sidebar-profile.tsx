import { useNavigate } from "react-router-dom";
import { PersonIcon } from "@primer/octicons-react";
import * as styles from "./sidebar.css";
import { useUserDetails } from "@renderer/hooks";
import { useMemo } from "react";

export function SidebarProfile() {
  const navigate = useNavigate();

  const { userDetails, profileBackground } = useUserDetails();

  const handleClickProfile = () => {
    navigate(`/user/${userDetails!.id}`);
  };

  const handleClickLogin = () => {
    window.electron.openExternal("https://auth.hydra.losbroxas.org");
  };

  const profileButtonBackground = useMemo(() => {
    if (profileBackground) return profileBackground;
    return undefined;
  }, [profileBackground]);

  if (userDetails == null) {
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
        style={{ background: profileButtonBackground }}
        onClick={handleClickProfile}
      >
        <div className={styles.profileAvatar}>
          {userDetails.profileImageUrl ? (
            <img
              className={styles.profileAvatar}
              src={userDetails.profileImageUrl}
              alt={userDetails.displayName}
            />
          ) : (
            <PersonIcon />
          )}
        </div>

        <div className={styles.profileButtonInformation}>
          <p style={{ fontWeight: "bold" }}>{userDetails.displayName}</p>
        </div>
      </button>
    </>
  );
}
