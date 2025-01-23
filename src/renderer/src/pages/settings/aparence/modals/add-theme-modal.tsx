import { Modal } from "@renderer/components/modal/modal";
import { TextField } from "@renderer/components/text-field/text-field";
import { useTranslation } from "react-i18next";
import "./modals.scss";
import { Button } from "@renderer/components/button/button";
import { useState } from "react";

interface AddThemeModalProps {
  visible: boolean;
  onClose: () => void;
}

export const AddThemeModal = ({ visible, onClose }: AddThemeModalProps) => {
  const { t } = useTranslation("settings");

  const [themeName, setThemeName] = useState("");

  return (
    <Modal
      visible={visible}
      title={t("add_theme")}
      description={t("add_theme_description")}
      onClose={onClose}
    >
      <div className="add-theme-modal__container">
        <TextField
          label={t("theme_name")}
          placeholder={t("insert_theme_name")}
          hint={t("theme_name_hint")}
          value={themeName}
          onChange={(e) => setThemeName(e.target.value)}
        />

        <Button theme="primary" onClick={onClose}>
          {t("add_theme")}
        </Button>
      </div>
    </Modal>
  );
};
