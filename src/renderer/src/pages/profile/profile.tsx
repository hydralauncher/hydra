import { ProfileContent } from "./profile-content/profile-content";
import { SkeletonTheme } from "react-loading-skeleton";
import { vars } from "@renderer/theme.css";

import * as styles from "./profile.css";
import { UserProfileContextProvider } from "@renderer/context";
import { useParams } from "react-router-dom";

export function Profile() {
  const { userId } = useParams();

  return (
    <UserProfileContextProvider userId={userId!}>
      <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
        <div className={styles.wrapper}>
          <ProfileContent />
        </div>
      </SkeletonTheme>
    </UserProfileContextProvider>
  );
}
