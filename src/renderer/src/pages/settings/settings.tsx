import { useEffect, useState } from "react";
import { Button } from "@renderer/components";

import * as styles from "./settings.css";
import { useTranslation } from "react-i18next";
import { UserPreferences } from "@types";
import { SettingsRealDebrid } from "./settings-real-debrid";
import { SettingsGeneral } from "./settings-general";
import { SettingsBehavior } from "./settings-behavior";

const categories = ["general", "behavior", "real_debrid"];

export function Settings() {
  const [currentCategory, setCurrentCategory] = useState(categories.at(0)!);
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(null);

  const { t } = useTranslation("settings");

  useEffect(() => {
    window.electron.getUserPreferences().then((userPreferences) => {
      setUserPreferences(userPreferences);
    });
  }, []);

  const handleUpdateUserPreferences = (values: Partial<UserPreferences>) => {
    window.electron.updateUserPreferences(values);
  };

  function renderCategory() {
    switch (currentCategory) {
      case "general":
        return (
          <SettingsGeneral
            userPreferences={userPreferences}
            updateUserPreferences={handleUpdateUserPreferences}
          />
        );
      case "real_debrid":
        return (
          <SettingsRealDebrid
            userPreferences={userPreferences}
            updateUserPreferences={handleUpdateUserPreferences}
          />
        );
      default:
        return (
          <SettingsBehavior
            userPreferences={userPreferences}
            updateUserPreferences={handleUpdateUserPreferences}
          />
        );
    }
  }

  return (
    <section className={styles.container}>
      <div className={styles.content}>
        <section className={styles.settingsCategories}>
          {categories.map((category) => (
            <Button
              key={category}
              theme={currentCategory === category ? "primary" : "outline"}
              onClick={() => setCurrentCategory(category)}
            >
              {t(category)}
            </Button>
          ))}
        </section>

        <h2>{t(currentCategory)}</h2>
        {renderCategory()}
      </div>
    </section>
  );
}
