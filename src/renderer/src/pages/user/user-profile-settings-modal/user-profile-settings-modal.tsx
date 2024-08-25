import { Button, Modal } from "@renderer/components";
import { UserProfile } from "@types";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UserEditProfile } from "./user-edit-profile";
import { UserEditProfileBlockList } from "./user-block-list";

export interface UserProfileSettingsModalProps {
  userProfile: UserProfile;
  visible: boolean;
  onClose: () => void;
  updateUserProfile: () => Promise<void>;
}

export const UserProfileSettingsModal = ({
  userProfile,
  visible,
  onClose,
  updateUserProfile,
}: UserProfileSettingsModalProps) => {
  const { t } = useTranslation("user_profile");

  const tabs = [t("edit_profile"), t("blocked_users")];

  const [currentTabIndex, setCurrentTabIndex] = useState(0);

  const renderTab = () => {
    if (currentTabIndex == 0) {
      return (
        <UserEditProfile
          userProfile={userProfile}
          updateUserProfile={updateUserProfile}
        />
      );
    }

    if (currentTabIndex == 1) {
      return <UserEditProfileBlockList />;
    }

    return <></>;
  };

  return (
    <>
      <Modal visible={visible} title={t("settings")} onClose={onClose}>
        <div
          style={{
            display: "flex",
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
          {renderTab()}
        </div>
      </Modal>
    </>
  );
};
