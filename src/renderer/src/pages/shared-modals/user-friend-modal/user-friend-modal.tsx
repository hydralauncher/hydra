import { Button, Modal } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { UserFriendModalAddFriend } from "./user-friend-modal-add-friend";
import { useToast, useUserDetails } from "@renderer/hooks";
import { UserFriendModalList } from "./user-friend-modal-list";
import { CopyIcon } from "@primer/octicons-react";
import * as styles from "./user-friend-modal.css";

export enum UserFriendModalTab {
  FriendsList,
  AddFriend,
}

export interface UserFriendsModalProps {
  visible: boolean;
  onClose: () => void;
  initialTab: UserFriendModalTab | null;
  userId: string;
}

export const UserFriendModal = ({
  visible,
  onClose,
  initialTab,
  userId,
}: UserFriendsModalProps) => {
  const { t } = useTranslation("user_profile");

  const tabs = [t("friends_list"), t("add_friends")];

  const [currentTab, setCurrentTab] = useState(
    initialTab || UserFriendModalTab.FriendsList
  );

  const { showSuccessToast } = useToast();

  const { userDetails } = useUserDetails();
  const isMe = userDetails?.id == userId;

  useEffect(() => {
    if (initialTab != null) {
      setCurrentTab(initialTab);
    }
  }, [initialTab]);

  const renderTab = () => {
    if (currentTab == UserFriendModalTab.FriendsList) {
      return <UserFriendModalList userId={userId} closeModal={onClose} />;
    }

    if (currentTab == UserFriendModalTab.AddFriend) {
      return <UserFriendModalAddFriend closeModal={onClose} />;
    }

    return <></>;
  };

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(userDetails!.id);
    showSuccessToast("Código de amigo copiado");
  }, [userDetails, showSuccessToast]);

  return (
    <Modal visible={visible} title={t("friends")} onClose={onClose}>
      <div
        style={{
          display: "flex",
          width: "500px",
          flexDirection: "column",
          gap: `${SPACING_UNIT * 2}px`,
        }}
      >
        {isMe && (
          <>
            <div
              style={{
                display: "flex",
                gap: `${SPACING_UNIT}px`,
                alignItems: "center",
              }}
            >
              <p>Seu código de amigo: </p>
              <button
                className={styles.friendCodeButton}
                onClick={copyToClipboard}
              >
                <h3>{userDetails.id}</h3>
                <CopyIcon />
              </button>
            </div>
            <section style={{ display: "flex", gap: `${SPACING_UNIT}px` }}>
              {tabs.map((tab, index) => {
                return (
                  <Button
                    key={tab}
                    theme={index === currentTab ? "primary" : "outline"}
                    onClick={() => setCurrentTab(index)}
                  >
                    {tab}
                  </Button>
                );
              })}
            </section>
          </>
        )}
        {renderTab()}
      </div>
    </Modal>
  );
};
