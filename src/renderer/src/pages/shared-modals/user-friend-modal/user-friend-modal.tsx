import { Button, Modal } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { UserFriendModalAddFriend } from "./user-friend-modal-add-friend";

export enum UserFriendModalTab {
  FriendsList,
  AddFriend,
}

export interface UserAddFriendsModalProps {
  visible: boolean;
  onClose: () => void;
  initialTab: UserFriendModalTab | null;
}

export const UserFriendModal = ({
  visible,
  onClose,
  initialTab,
}: UserAddFriendsModalProps) => {
  const { t } = useTranslation("user_profile");

  const tabs = [t("friends_list"), t("add_friends")];

  const [currentTab, setCurrentTab] = useState(
    initialTab || UserFriendModalTab.FriendsList
  );

  useEffect(() => {
    if (initialTab != null) {
      setCurrentTab(initialTab);
    }
  }, [initialTab]);

  const renderTab = () => {
    if (currentTab == UserFriendModalTab.FriendsList) {
      return <></>;
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
        <h2>{tabs[currentTab]}</h2>
        {renderTab()}
      </div>
    </Modal>
  );
};
