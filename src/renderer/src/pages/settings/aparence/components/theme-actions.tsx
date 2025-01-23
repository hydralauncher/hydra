import { GlobeIcon, TrashIcon } from "@primer/octicons-react";
import { PlusIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components/button/button";
import { useTranslation } from "react-i18next";
import "./theme-actions.scss";

export const ThemeActions = () => {
  const { t } = useTranslation();

  return (
    <div className="settings-appearance__actions">
      <div className="settings-appearance__actions-left">
        <Button theme="primary" className="settings-appearance__button">
          <GlobeIcon />
          {t("web_store")}
        </Button>

        <Button theme="danger" className="settings-appearance__button">
          <TrashIcon />
          {t("clear_themes")}
        </Button>
      </div>

      <div className="settings-appearance__actions-right">
        <Button theme="outline" className="settings-appearance__button">
          <PlusIcon />
          {t("add_theme")}
        </Button>
      </div>
    </div>
  );
};
