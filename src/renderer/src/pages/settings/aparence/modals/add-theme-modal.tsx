import { Modal } from "@renderer/components/modal/modal";
import { TextField } from "@renderer/components/text-field/text-field";
import { Button } from "@renderer/components/button/button";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import "./modals.scss";

interface AddThemeModalProps {
  visible: boolean;
  onClose: () => void;
  onThemeAdded: () => void;
}

export const AddThemeModal = ({
  visible,
  onClose,
  onThemeAdded,
}: AddThemeModalProps) => {
  const { t } = useTranslation("settings");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (!name || name.length < 3) {
      setError(t("theme_name_error_hint"));
      return;
    }

    const theme = {
      id: crypto.randomUUID(),
      name,
      isActive: false,
      colors: {
        accent: "#c0c1c7",
        background: "#1c1c1c",
        surface: "#151515",
      },
    };

    await window.electron.addCustomTheme(theme);
    setName("");
    setError("");
    onThemeAdded();
    onClose();
  };

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
          value={name}
          onChange={(e) => setName(e.target.value)}
          hint={error}
          error={!!error}
          onKeyDown={handleKeyDown}
        />

        <Button theme="primary" onClick={handleSubmit}>
          {t("add_theme")}
        </Button>
      </div>
    </Modal>
  );
};
