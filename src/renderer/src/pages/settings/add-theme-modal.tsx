import { useTranslation } from "react-i18next";
import { Modal, Button } from "@renderer/components";

interface AddThemeModalProps {
  visible: boolean;
  onClose: () => void;
  onAddTheme: () => void;
}

export function AddThemeModal({
  visible,
  onClose,
  onAddTheme,
}: AddThemeModalProps) {
  const { t } = useTranslation("settings");

  return (
    <Modal title={t("add_theme")} visible={visible} onClose={onClose}>
      <div className="add-theme-modal">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAddTheme();
          }}
        >
          <div className="modal-content">{/* placeholder for now */}</div>

          <div className="modal-footer">
            <Button type="button" theme="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" theme="primary">
              {t("add")}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
