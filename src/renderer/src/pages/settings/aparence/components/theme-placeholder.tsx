import { AlertIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./theme-placeholder.scss";
import { AddThemeModal } from "../modals/add-theme-modal";
import { useState } from "react";

interface ThemePlaceholderProps {
  onListUpdated: () => void;
}

export const ThemePlaceholder = ({ onListUpdated }: ThemePlaceholderProps) => {
  const { t } = useTranslation("settings");

  const [addThemeModalVisible, setAddThemeModalVisible] = useState(false);

  return (
    <>
      <AddThemeModal
        visible={addThemeModalVisible}
        onClose={() => setAddThemeModalVisible(false)}
        onThemeAdded={onListUpdated}
      />

      <button
        className="theme-placeholder"
        onClick={() => setAddThemeModalVisible(true)}
      >
        <div className="theme-placeholder__icon">
          <AlertIcon />
        </div>

        <p className="theme-placeholder__text">{t("no_themes")}</p>
      </button>
    </>
  );
};
