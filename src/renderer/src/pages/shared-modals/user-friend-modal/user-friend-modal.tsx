import { Button, Modal } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { UserFriendModalAddFriend } from "./user-friend-modal-add-friend";
import { useUserDetails } from "@renderer/hooks";
import { UserFriendModalList } from "./user-friend-modal-list";

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
        )}
        {renderTab()}
      </div>
    </Modal>
  );
};
