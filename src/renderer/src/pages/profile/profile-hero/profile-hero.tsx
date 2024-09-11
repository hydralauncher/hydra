import { SPACING_UNIT } from "@renderer/theme.css";

import * as styles from "./profile-hero.css";
import { useContext, useMemo } from "react";
import { userProfileContext } from "@renderer/context";
import {
  CheckCircleFillIcon,
  PersonIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { buildGameDetailsPath } from "@renderer/helpers";
import { Button, Link } from "@renderer/components";
import { useTranslation } from "react-i18next";
import { useDate } from "@renderer/hooks";

export function ProfileHero() {
  const { userProfile, heroBackground, isMe } = useContext(userProfileContext);

  const { t } = useTranslation("user_profile");
  const { formatDistance } = useDate();

  if (!userProfile) return null;

  const { currentGame } = userProfile;

  console.log(userProfile);

  const profileActions = useMemo(() => {
    if (isMe) {
      return (
        <>
          <Button theme="outline">{t("settings")}</Button>

          <Button theme="danger">{t("sign_out")}</Button>
        </>
      );
    }

    // if (userProfile.relation == null) {
    //   return (
    //     <>
    //       <Button
    //         theme="outline"
    //         onClick={() => handleFriendAction(userProfile.id, "SEND")}
    //       >
    //         {t("add_friend")}
    //       </Button>

    //       <Button theme="danger" onClick={() => setShowUserBlockModal(true)}>
    //         {t("block_user")}
    //       </Button>
    //     </>
    //   );
    // }

    // if (userProfile.relation.status === "ACCEPTED") {
    //   return (
    //     <>
    //       <Button
    //         theme="outline"
    //         // className={styles.cancelRequestButton}
    //         // onClick={() => setShowUndoFriendshipModal(true)}
    //       >
    //         <XCircleFillIcon size={28} /> {t("undo_friendship")}
    //       </Button>
    //     </>
    //   );
    // }

    // if (userProfile.relation.BId === userProfile.id) {
    //   return (
    //     <Button
    //       theme="outline"
    //       // className={styles.cancelRequestButton}
    //       // onClick={() =>
    //       //   handleFriendAction(userProfile.relation!.BId, "CANCEL")
    //       // }
    //     >
    //       <XCircleFillIcon size={28} /> {t("cancel_request")}
    //     </Button>
    //   );
    // }

    return (
      <>
        <Button
          theme="outline"
          // onClick={() =>
          //   handleFriendAction(userProfile.relation!.AId, "ACCEPTED")
          // }
        >
          <CheckCircleFillIcon size={28} /> {t("accept_request")}
        </Button>
        <Button
          theme="outline"
          // onClick={() =>
          //   handleFriendAction(userProfile.relation!.AId, "REFUSED")
          // }
        >
          <XCircleFillIcon size={28} /> {t("ignore_request")}
        </Button>
      </>
    );
  }, []);

  return (
    <>
      <section
        className={styles.profileContentBox}
        style={{ background: heroBackground }}
      >
        <div
          style={{
            display: "flex",
            padding: `${SPACING_UNIT * 4}px ${SPACING_UNIT * 3}px`,
            alignItems: "center",
            gap: `${SPACING_UNIT * 2}px`,
          }}
        >
          <div className={styles.profileAvatarContainer}>
            {userProfile.profileImageUrl ? (
              <img
                className={styles.profileAvatar}
                alt={userProfile.displayName}
                src={userProfile.profileImageUrl}
              />
            ) : (
              <PersonIcon size={72} />
            )}
          </div>

          <div className={styles.profileInformation}>
            <h2 className={styles.profileDisplayName}>
              {userProfile.displayName}
            </h2>
            {currentGame && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: `${SPACING_UNIT / 2}px`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    gap: `${SPACING_UNIT}px`,
                    alignItems: "center",
                  }}
                >
                  <Link to={buildGameDetailsPath(currentGame)}>
                    {currentGame.title}
                  </Link>
                </div>
                <small>
                  {t("playing_for", {
                    amount: formatDistance(
                      currentGame.sessionDurationInSeconds,
                      new Date()
                    ),
                  })}
                </small>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            width: "100%",
            height: "72px",
            minHeight: "72px",
            padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 3}px`,
            display: "flex",
            gap: `${SPACING_UNIT}px`,
            justifyContent: "space-between",
            backdropFilter: `blur(10px)`,
            borderTop: `solid 1px rgba(255, 255, 255, 0.1)`,
            boxShadow: "0px 0px 15px 0px rgba(0, 0, 0, 0.5)",
          }}
        >
          <div></div>
          <div style={{ display: "flex", gap: `${SPACING_UNIT}px` }}>
            {profileActions}
          </div>
        </div>
      </section>
    </>
  );
}
