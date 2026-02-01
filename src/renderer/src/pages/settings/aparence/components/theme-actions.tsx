import { Global, Trash, Add } from "iconsax-reactjs";
import { Button } from "@renderer/components/button/button";
import { useTranslation } from "react-i18next";
import { AddThemeModal, DeleteAllThemesModal } from "../index";
import "./theme-actions.scss";
import { useState } from "react";
import { THEME_WEB_STORE_URL } from "@renderer/constants";

interface ThemeActionsProps {
  onListUpdated: () => void;
  themesCount: number;
}

export const ThemeActions = ({
  onListUpdated,
  themesCount,
}: ThemeActionsProps) => {
  const { t } = useTranslation("settings");

  const [addThemeModalVisible, setAddThemeModalVisible] = useState(false);
  const [deleteAllThemesModalVisible, setDeleteAllThemesModalVisible] =
    useState(false);

  return (
    <>
      <AddThemeModal
        visible={addThemeModalVisible}
        onClose={() => setAddThemeModalVisible(false)}
        onThemeAdded={onListUpdated}
      />

      <DeleteAllThemesModal
        visible={deleteAllThemesModalVisible}
        onClose={() => setDeleteAllThemesModalVisible(false)}
        onThemesDeleted={onListUpdated}
      />

      <div className="settings-appearance__actions">
        <div className="settings-appearance__actions-left">
          <Button
            theme="primary"
            className="settings-appearance__button"
            onClick={() => {
              window.open(THEME_WEB_STORE_URL, "_blank");
            }}
          >
            <Global size={20} variant="Linear" />
            {t("web_store")}
          </Button>

          <Button
            theme="danger"
            className="settings-appearance__button"
            onClick={() => setDeleteAllThemesModalVisible(true)}
            disabled={themesCount < 1}
          >
            <Trash size={20} variant="Linear" />
            {t("clear_themes")}
          </Button>
        </div>

        <div className="settings-appearance__actions-right">
          <Button
            theme="outline"
            className="settings-appearance__button"
            onClick={() => setAddThemeModalVisible(true)}
          >
            <Add size={20} variant="Linear" />
            {t("create_theme")}
          </Button>
        </div>
      </div>
    </>
  );
};
