import { useEffect, useState } from "react";
import { Button } from "@renderer/components";

import * as styles from "./settings.css";
import { useTranslation } from "react-i18next";
import { UserPreferences } from "@types";
import { SettingsRealDebrid } from "./settings-real-debrid";
import { SettingsGeneral } from "./settings-general";
import { SettingsBehavior } from "./settings-behavior";

export function Settings() {
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(null);

  const { t } = useTranslation("settings");

  const categories = [t("general"), t("behavior"), "Real-Debrid"];

  const [currentCategoryIndex, setCurrentCategoryIndex] = useState(0);

  useEffect(() => {
    window.electron.getUserPreferences().then((userPreferences) => {
      setUserPreferences(userPreferences);
    });
  }, []);

  const handleUpdateUserPreferences = async (
    values: Partial<UserPreferences>
  ) => {
    await window.electron.updateUserPreferences(values);
    window.electron.getUserPreferences().then((userPreferences) => {
      setUserPreferences(userPreferences);
    });
  };

  const renderCategory = () => {
    if (currentCategoryIndex === 0) {
      return (
        <SettingsGeneral
          userPreferences={userPreferences}
          updateUserPreferences={handleUpdateUserPreferences}
        />
      );
    }

    if (currentCategoryIndex === 1) {
      return (
        <SettingsBehavior
          userPreferences={userPreferences}
          updateUserPreferences={handleUpdateUserPreferences}
        />
      );
    }

    return (
      <SettingsRealDebrid
        userPreferences={userPreferences}
        updateUserPreferences={handleUpdateUserPreferences}
      />
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
