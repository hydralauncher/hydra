import { Button, Modal } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UserFriendModalAddFriend } from "./user-friend-modal-add-friend";

export interface UserAddFriendsModalProps {
  visible: boolean;
  onClose: () => void;
}

export const UserFriendModal = ({
  visible,
  onClose,
}: UserAddFriendsModalProps) => {
  const { t } = useTranslation("user_profile");

  const tabs = [t("add_friends"), t("friends_list")];

  const [currentTabIndex, setCurrentTabIndex] = useState(0);

  const renderTab = () => {
    if (currentTabIndex == 0) {
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
                theme={index === currentTabIndex ? "primary" : "outline"}
                onClick={() => setCurrentTabIndex(index)}
              >
                {tab}
              </Button>
            );
          })}
        </section>
        <h2>{tabs[currentTabIndex]}</h2>
        {renderTab()}
      </div>
    </Modal>
  );
};
