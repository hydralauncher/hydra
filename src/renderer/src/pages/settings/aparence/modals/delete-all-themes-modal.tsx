import { Button } from "@renderer/components/button/button";
import { Modal } from "@renderer/components/modal/modal";
import { useTranslation } from "react-i18next";
import "./modals.scss";

interface DeleteAllThemesModalProps {
  visible: boolean;
  onClose: () => void;
}

export const DeleteAllThemesModal = ({
  visible,
  onClose,
}: DeleteAllThemesModalProps) => {
  const { t } = useTranslation("settings");

  return (
    <Modal
      visible={visible}
      title={t("delete_all_themes")}
      description={t("delete_all_themes_description")}
      onClose={onClose}
    >
      <div className="delete-all-themes-modal__container">
        <Button theme="outline" onClick={onClose}>
          {t("delete_all_themes")}
        </Button>

        <Button theme="primary" onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>
    </Modal>
  );
};
