import { Button } from "@renderer/components/button/button";
import { Modal } from "@renderer/components/modal/modal";
import { useTranslation } from "react-i18next";
import "./modals.scss";

interface DeleteThemeModalProps {
  visible: boolean;
  onClose: () => void;
  themeId: string;
}

export const DeleteThemeModal = ({
  visible,
  onClose,
}: DeleteThemeModalProps) => {
  const { t } = useTranslation("settings");

  return (
    <Modal
      visible={visible}
      title={t("delete_theme")}
      description={t("delete_theme_description")}
      onClose={onClose}
    >
      <div className="delete-all-themes-modal__container">
        <Button theme="outline" onClick={onClose}>
          {t("delete_theme")}
        </Button>

        <Button theme="primary" onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>
    </Modal>
  );
};
