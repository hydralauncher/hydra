import { Button, Modal } from "@renderer/components";
import * as styles from "./user.css";
import { useTranslation } from "react-i18next";

export interface UserEditProfileModalProps {
  visible: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const UserSignOutModal = ({
  visible,
  onConfirm,
  onClose,
}: UserEditProfileModalProps) => {
  const { t } = useTranslation("user_profile");

  return (
    <>
      <Modal
        visible={visible}
        title={t("sign_out_modal_title")}
        onClose={onClose}
      >
        <div className={styles.signOutModalContent}>
          <p style={{ fontFamily: "Fira Sans" }}>{t("sign_out_modal_text")}</p>
          <div className={styles.signOutModalButtonsContainer}>
            <Button onClick={onConfirm} theme="danger">
              {t("sign_out")}
            </Button>

            <Button onClick={onClose} theme="primary">
              {t("cancel")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
