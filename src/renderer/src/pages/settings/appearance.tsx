import { useContext, useEffect, useState } from "react";
import { Button } from "@renderer/components";
import { useTranslation } from "react-i18next";
import { AddThemeModal } from "./add-theme-modal";
import { settingsContext } from "@renderer/context";
import {
  PlusCircleIcon,
  GlobeIcon,
  PencilIcon,
} from "@primer/octicons-react";

import * as styles from "./settings-download-sources.css";

export function SettingsAppearance() {
  const { t } = useTranslation("settings");

  const [showAddThemeModal, setShowAddThemeModal] = useState(false);
  const { sourceUrl, clearSourceUrl } = useContext(settingsContext);

  useEffect(() => {
    if (sourceUrl) setShowAddThemeModal(true);
  }, [sourceUrl]);

  const handleModalClose = () => {
    clearSourceUrl();
    setShowAddThemeModal(false);
  };

  return (
    <>
      <AddThemeModal
        visible={showAddThemeModal}
        onClose={handleModalClose}
        onAddTheme={() => {}}
      />

      <p>{t("themes_description")}</p>

      <div className={styles.downloadSourcesHeader}>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button type="button" theme="outline">
            <GlobeIcon />
            {t("open_store")}
          </Button>

          <Button type="button" theme="outline">
            <PencilIcon />
            {t("editor_mode")}
          </Button>
        </div>

        <Button
          type="button"
          theme="outline"
          onClick={() => setShowAddThemeModal(true)}
        >
          <PlusCircleIcon />
          {t("add_theme")}
        </Button>
      </div>
    </>
  );
}
