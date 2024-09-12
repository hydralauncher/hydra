import { useParams } from "react-router-dom";
import { ProfileSkeleton } from "./profile-skeleton";
import { ProfileContent } from "./profile-content/profile-content";
import { SkeletonTheme } from "react-loading-skeleton";
import { vars } from "@renderer/theme.css";

import * as styles from "./profile.css";
import {
  UserProfileContextConsumer,
  UserProfileContextProvider,
} from "@renderer/context";

export function Profile() {
  const { userId } = useParams();

  return (
    <UserProfileContextProvider userId={userId!}>
      <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
        <div className={styles.wrapper}>
          <UserProfileContextConsumer>
            {({ userProfile }) =>
              userProfile ? <ProfileContent /> : <ProfileSkeleton />
            }
          </UserProfileContextConsumer>
        </div>
      </SkeletonTheme>
    </UserProfileContextProvider>
  );
}
