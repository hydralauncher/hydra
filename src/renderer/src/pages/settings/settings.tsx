import { useState } from "react";
import { Button } from "@renderer/components";

import * as styles from "./settings.css";
import { useTranslation } from "react-i18next";
import { UserPreferences } from "@types";
import { SettingsRealDebrid } from "./settings-real-debrid";
import { SettingsGeneral } from "./settings-general";
import { SettingsBehavior } from "./settings-behavior";
import { useAppDispatch } from "@renderer/hooks";
import { setUserPreferences } from "@renderer/features";
import { SettingsDownloadSources } from "./settings-download-sources";

export function Settings() {
  const { t } = useTranslation("settings");

  const dispatch = useAppDispatch();

  const categories = [
    t("general"),
    t("behavior"),
    t("download_sources"),
    "Real-Debrid",
  ];

  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);

  const handleUpdateUserPreferences = async (
    values: Partial<UserPreferences>
  ) => {
    await window.electron.updateUserPreferences(values);
    window.electron.getUserPreferences().then((userPreferences) => {
      dispatch(setUserPreferences(userPreferences));
    });
  };

  const renderCategory = () => {
    if (currentCategoryIndex === 0) {
      return (
        <SettingsGeneral updateUserPreferences={handleUpdateUserPreferences} />
      );
    }

    if (currentCategoryIndex === 1) {
      return (
        <SettingsBehavior updateUserPreferences={handleUpdateUserPreferences} />
      );
    }

    if (currentCategoryIndex === 2) {
      return <SettingsDownloadSources />;
    }

    return (
      <SettingsRealDebrid updateUserPreferences={handleUpdateUserPreferences} />
    );
  };

  return (
    <section className={styles.container}>
      <div className={styles.content}>
        <section className={styles.settingsCategories}>
          {categories.map((category, index) => (
            <Button
              key={category}
              theme={currentCategoryIndex === index ? "primary" : "outline"}
              onClick={() => setCurrentCategoryIndex(index)}
            >
              {category}
            </Button>
          ))}
        </section>

        <h2>{categories[currentCategoryIndex]}</h2>
        {renderCategory()}
      </div>
    </section>
  );
}
