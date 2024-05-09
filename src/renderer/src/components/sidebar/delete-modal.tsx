import { useTranslation } from "react-i18next";

import { Button, Modal } from "@renderer/components";

import { useDownload } from "@renderer/hooks";
import * as styles from "./delete-modal.css";

interface DeleteModalProps {
  visible: boolean;
  onClose: () => void;
  gameId: number;
}

export function DeleteModal({ gameId, onClose, visible }: DeleteModalProps) {
  const { t } = useTranslation("downloads");
  const { removeInstallationFolder, isGameDeleting } = useDownload();

  const deleteGameFolder = async () => {
    removeInstallationFolder(gameId);

    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("delete_modal_title")}
      description={t("delete_installation_modal_description")}
      onClose={onClose}
    >
      <div className={styles.deleteActionsButtonsCtn}>
        <Button
          disabled={isGameDeleting(gameId)}
          onClick={deleteGameFolder}
          theme="outline"
        >
          {t("delete")}
        </Button>

        <Button onClick={onClose} theme="primary">
          {t("cancel")}
        </Button>
      </div>
    </Modal>
  );
}
