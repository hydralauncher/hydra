import { AlertIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./theme-placeholder.scss";

interface ThemePlaceholderProps {
  setAddThemeModalVisible: (visible: boolean) => void;
}

export const ThemePlaceholder = ({
  setAddThemeModalVisible,
}: ThemePlaceholderProps) => {
  const { t } = useTranslation();

  return (
    <button
      className="theme-placeholder"
      onClick={() => setAddThemeModalVisible(true)}
    >
      <div className="theme-placeholder__icon">
        <AlertIcon />
      </div>

      <p className="theme-placeholder__text">{t("no_themes")}</p>
    </button>
  );
};
