import { GlobeIcon, TrashIcon, PlusIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components/button/button";
import { useTranslation } from "react-i18next";
import { AddThemeModal, DeleteAllThemesModal } from "../index";
import "./theme-actions.scss";
import { useState } from "react";

interface ThemeActionsProps {
  onListUpdated: () => void;
  themesCount: number;
}

export const ThemeActions = ({ onListUpdated, themesCount }: ThemeActionsProps) => {
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
          <Button theme="primary" className="settings-appearance__button">
            <GlobeIcon />
            {t("web_store")}
          </Button>

          <Button
            theme="danger"
            className="settings-appearance__button"
            onClick={() => setDeleteAllThemesModalVisible(true)}
            disabled={themesCount < 1}
          >
            <TrashIcon />
            {t("clear_themes")}
          </Button>
        </div>

        <div className="settings-appearance__actions-right">
          <Button
            theme="outline"
            className="settings-appearance__button"
            onClick={() => setAddThemeModalVisible(true)}
          >
            <PlusIcon />
            {t("add_theme")}
          </Button>
        </div>
      </div>
    </>
  );
};
