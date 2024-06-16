import { useNavigate } from "react-router-dom";
import { PersonIcon } from "@primer/octicons-react";
import * as styles from "./sidebar.css";
import { useUserAuth } from "@renderer/hooks/use-user-auth";

export function SidebarProfile() {
  const navigate = useNavigate();

  const { userAuth, isLoading } = useUserAuth();

  const handleClickProfile = () => {
    navigate(`/user/${userAuth!.id}`);
  };

  const handleClickLogin = () => {
    window.electron.openExternal("https://auth.losbroxas.org");
  };

  if (isLoading) return null;

  if (userAuth == null) {
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
          {userAuth.profileImageUrl ? (
            <img
              className={styles.profileAvatar}
              src={userAuth.profileImageUrl}
              alt={userAuth.displayName}
            />
          ) : (
            <PersonIcon />
          )}
        </div>

        <div className={styles.profileButtonInformation}>
          <p style={{ fontWeight: "bold" }}>{userAuth.displayName}</p>
        </div>
      </button>
    </>
  );
}
