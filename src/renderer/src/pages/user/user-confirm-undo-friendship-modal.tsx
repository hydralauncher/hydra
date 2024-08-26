import { Button, Modal } from "@renderer/components";
import * as styles from "./user.css";
import { useTranslation } from "react-i18next";

export interface UserConfirmUndoFriendshipModalProps {
  visible: boolean;
  displayName: string;
  onConfirm: () => void;
  onClose: () => void;
}

export const UserConfirmUndoFriendshipModal = ({
  visible,
  displayName,
  onConfirm,
  onClose,
}: UserConfirmUndoFriendshipModalProps) => {
  const { t } = useTranslation("user_profile");

  return (
    <>
      <Modal
        visible={visible}
        title={t("sign_out_modal_title")}
        onClose={onClose}
      >
        <div className={styles.signOutModalContent}>
          <p>{t("undo_friendship_modal_text", { displayName })}</p>
          <div className={styles.signOutModalButtonsContainer}>
            <Button onClick={onConfirm} theme="danger">
              {t("undo_friendship")}
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
