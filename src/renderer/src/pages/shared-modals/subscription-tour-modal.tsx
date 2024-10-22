import { useTranslation } from "react-i18next";
import { Button, Modal } from "../../components";
import { SPACING_UNIT } from "../../theme.css";

export interface UserFriendsModalProps {
  visible: boolean;
  onClose: () => void;
}

export const SubscriptionTourModal = ({
  visible,
  onClose,
}: UserFriendsModalProps) => {
  const { t } = useTranslation("tour");

  const handleSubscribeClick = () => {
    window.electron.openCheckout().finally(onClose);
  };

  return (
    <Modal
      visible={visible}
      title={t("subscription_tour_title")}
      onClose={onClose}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: `${SPACING_UNIT * 2}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: `${SPACING_UNIT * 2}px`,
            justifyContent: "space-around",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: `${SPACING_UNIT * 2}px`,
            }}
          >
            <h2>Hydra Cloud</h2>
            <ul style={{ margin: "0", padding: "0" }}>
              <li style={{ margin: `${SPACING_UNIT}px ${SPACING_UNIT * 2}px` }}>
                {t("cloud_saving")}
              </li>
              <li style={{ margin: `${SPACING_UNIT}px ${SPACING_UNIT * 2}px` }}>
                {t("cloud_achievements")}
              </li>
              <li style={{ margin: `${SPACING_UNIT}px ${SPACING_UNIT * 2}px` }}>
                {t("show_and_compare_achievements")}
              </li>
              <li style={{ margin: `${SPACING_UNIT}px ${SPACING_UNIT * 2}px` }}>
                {t("animated_profile_banner")}
              </li>
              <li style={{ margin: `${SPACING_UNIT}px ${SPACING_UNIT * 2}px` }}>
                {t("animated_profile_picture")}
              </li>
              <li style={{ margin: `${SPACING_UNIT}px ${SPACING_UNIT * 2}px` }}>
                {t("premium_support")}
              </li>
            </ul>
          </div>
        </div>
        <Button onClick={handleSubscribeClick}>{t("subscribe_now")}</Button>
      </div>
    </Modal>
  );
};
