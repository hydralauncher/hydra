import { Button, Modal } from "@renderer/components";
import * as styles from "./profile.css";
import { useTranslation } from "react-i18next";

export interface UserBlockModalProps {
  visible: boolean;
  displayName: string;
  onConfirm: () => void;
  onClose: () => void;
}

export const UserBlockModal = ({
  visible,
  displayName,
  onConfirm,
  onClose,
}: UserBlockModalProps) => {
  const { t } = useTranslation("user_profile");

  return (
    <>
      <Modal
        visible={visible}
        title={t("sign_out_modal_title")}
        onClose={onClose}
      >
        <div className={styles.signOutModalContent}>
          <p>{t("user_block_modal_text", { displayName })}</p>
          <div className={styles.signOutModalButtonsContainer}>
            <Button onClick={onConfirm} theme="danger">
              {t("block_user")}
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
